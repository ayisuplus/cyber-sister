import { beforeEach, describe, expect, it, vi } from 'vitest'

const gatewayComplete = vi.hoisted(() => vi.fn())
const gatewayStream = vi.hoisted(() => vi.fn())

vi.mock('@cyber-sister/llm-gateway', () => ({
  createGateway: vi.fn(() => Promise.resolve({
    complete: gatewayComplete,
    stream: gatewayStream,
    getHealth: () => [],
  })),
}))

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  buildMemoryContext,
  buildModelMessages,
  buildGatewayEnv,
  filterModelOutput,
  generateCompanionNote,
  generateExplanationWithModel,
  generateLocalTemplateResponse,
  generateResponse,
  generateResponseStream,
  CloudConsentRequiredError,
  LlmUnavailableError,
  redactSensitiveText,
  resetGatewayCache,
  retrieveRelevantMemories,
} from './llmService.js'

// 云端切割（2026-09-07）：供应商槽 GATEWAY_QWEN_* 是唯一 provider。
// 测试通过环境变量控制供应商是否配置（isCloudProviderConfigured 直接读 env）。
const CLOUD_ENV = {
  GATEWAY_QWEN_BASE_URL: 'https://example.invalid/v1',
  GATEWAY_QWEN_MODEL: 'qwen-model',
  GATEWAY_QWEN_API_KEY: 'k',
}

function withCloudEnv() {
  Object.assign(process.env, CLOUD_ENV)
}

function withoutCloudEnv() {
  for (const key of Object.keys(CLOUD_ENV)) delete process.env[key]
}

const authorized = () => Promise.resolve(true)

async function collectEvents(generator) {
  const events = []
  for await (const event of generator) events.push(event)
  return events
}

function streamOf(events) {
  return (async function* () {
    for (const event of events) yield event
  })()
}

describe('llmService 数据最小化', () => {
  beforeEach(() => {
    gatewayComplete.mockReset()
    gatewayStream.mockReset()
    resetGatewayCache()
    withCloudEnv()
  })

  it('最多发送 19 条历史加当前消息，且只保留 role/content', () => {
    const history = Array.from({ length: 25 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `消息${index}`,
      createdAt: new Date(),
      userId: 'should-not-leak',
    }))

    const messages = buildModelMessages('当前消息', history)
    expect(messages).toHaveLength(20)
    expect(messages.at(-1)).toEqual({ role: 'user', content: '当前消息' })
    expect(Object.keys(messages[0]).sort()).toEqual(['content', 'role'])
    expect(messages[0].content).toBe('消息6')
  })

  it('确定性脱敏手机号、邮箱与证件号（NFKC 归一后全角逗号变半角）', () => {
    expect(redactSensitiveText('打我13800138000或a@b.co，证件110101199001011234'))
      .toBe('打我[手机号]或[邮箱],证件[证件号]')
  })

  it('记忆上下文带不可信包裹，且不含原始 importance', () => {
    const context = buildMemoryContext([{ type: 'semantic', content: '喜欢火锅', importance: 9 }])
    expect(context).toContain('【不可信用户记忆数据】')
    expect(context).toContain('"content":"喜欢火锅"')
    expect(context).not.toContain('importance')
  })

  it('retrieveRelevantMemories 只返回有词重合的记忆', () => {
    const memories = [
      { id: '1', type: 'semantic', content: '用户喜欢吃火锅', importance: 5, tags: [] },
      { id: '2', type: 'semantic', content: '完全无关的内容', importance: 10, tags: [] },
    ]
    const result = retrieveRelevantMemories('火锅好吃吗', memories)
    expect(result.map((m) => m.id)).toEqual(['1'])
  })
})

describe('filterModelOutput 与本地安全模板', () => {
  it('命中拱火/冒充真人等红线时替换为人格模板', () => {
    const filtered = filterModelOutput('听我的，立刻分手', '我该怎么办', 'toxic')
    expect(filtered.filtered).toBe(true)
    expect(filtered.source).toBe('local_template')
  })

  it('正常内容原样通过并标记来源', () => {
    const passed = filterModelOutput('这事儿他做得不对。', '吐槽', 'toxic', 'qwen')
    expect(passed).toMatchObject({ filtered: false, source: 'qwen' })
  })

  it('本地模板按人格与情绪取文案，工作场景用统一兜底', () => {
    expect(generateLocalTemplateResponse('今天有点焦虑', 'toxic').source).toBe('local_template')
    expect(generateLocalTemplateResponse('随便', 'toxic', 'work').content)
      .toBe('我这边工具暂时没跟上。请把任务再说具体一点，我直接按步骤来。')
  })
})

describe('buildGatewayEnv 云端唯一路径', () => {
  it('供应商固定为 qwen，场景路由不含 llamacpp', () => {
    const env = buildGatewayEnv(CLOUD_ENV)
    expect(env.GATEWAY_PROVIDERS).toBe('qwen')
    expect(env.GATEWAY_SCENE_chat).toBe('qwen')
    expect(env.GATEWAY_SCENE_explain).toBe('qwen')
    expect(env.GATEWAY_LLAMACPP_BASE_URL).toBeUndefined()
  })
})

describe('generateResponse 同意门', () => {
  beforeEach(() => {
    gatewayComplete.mockReset()
    resetGatewayCache()
    withCloudEnv()
  })

  it('未同意（allowExternal=false）时抛 CLOUD_NOT_CONSENTED 且不调用网关', async () => {
    await expect(generateResponse('你好', 'toxic', [], [], 'req-1', { allowExternal: false }))
      .rejects.toThrow(CloudConsentRequiredError)
    expect(gatewayComplete).not.toHaveBeenCalled()
  })

  it('供应商未配置时抛 LLM_UNAVAILABLE，即使已同意', async () => {
    withoutCloudEnv()
    await expect(generateResponse('你好', 'toxic', [], [], 'req-1', { allowExternal: true, authorizeExternal: authorized }))
      .rejects.toThrow(LlmUnavailableError)
    expect(gatewayComplete).not.toHaveBeenCalled()
  })

  it('已同意且网关返回内容时来源为 qwen', async () => {
    gatewayComplete.mockResolvedValue({ content: '我在。', provider: 'qwen', model: 'm', scope: 'external' })
    const result = await generateResponse('你好', 'toxic', [], [], 'req-1', { allowExternal: true, authorizeExternal: authorized })
    expect(result).toMatchObject({ source: 'qwen', provider: 'qwen' })
  })

  it('已同意但网关无内容且授权仍有效时抛 LLM_UNAVAILABLE', async () => {
    gatewayComplete.mockResolvedValue(null)
    await expect(generateResponse('你好', 'toxic', [], [], 'req-1', { allowExternal: true, authorizeExternal: authorized }))
      .rejects.toThrow(LlmUnavailableError)
  })
})

describe('generateResponseStream 分句安全流', () => {
  beforeEach(() => {
    gatewayStream.mockReset()
    resetGatewayCache()
    withCloudEnv()
  })

  it('未同意时首句前产出 CLOUD_NOT_CONSENTED 且不调用网关', async () => {
    const events = await collectEvents(generateResponseStream('你好', 'toxic', [], [], 'req-1', { allowExternal: false }))
    expect(events).toEqual([{ type: 'error', reason: 'CLOUD_NOT_CONSENTED' }])
    expect(gatewayStream).not.toHaveBeenCalled()
  })

  it('按句界分句产出，尾段随 done 收尾', async () => {
    gatewayStream.mockReturnValue(streamOf([
      { type: 'delta', text: '第一句。第二句！' },
      { type: 'done', provider: 'qwen', model: 'm', scope: 'external' },
    ]))
    const events = await collectEvents(generateResponseStream('你好', 'toxic', [], [], 'req-1', { allowExternal: true, authorizeExternal: authorized }))
    expect(events[0]).toEqual({ type: 'sentence', text: '第一句。' })
    expect(events[1]).toEqual({ type: 'sentence', text: '第二句！' })
    expect(events.at(-1)).toMatchObject({ type: 'done', source: 'qwen' })
  })

  it('累计安全检查命中时中止上游并以本地模板 replace', async () => {
    gatewayStream.mockReturnValue(streamOf([
      { type: 'delta', text: '听我的，立刻辞职。' },
      { type: 'done', provider: 'qwen', model: 'm', scope: 'external' },
    ]))
    const events = await collectEvents(generateResponseStream('我该怎么办', 'toxic', [], [], 'req-1', { allowExternal: true, authorizeExternal: authorized }))
    expect(events[0].type).toBe('replace')
    expect(events.at(-1)).toMatchObject({ type: 'done', source: 'local_template' })
  })

  it('首句产出后上游失败只报 STREAM_FAILED', async () => {
    gatewayStream.mockReturnValue(streamOf([
      { type: 'delta', text: '先说一句。' },
      { type: 'error', reason: 'upstream_error' },
    ]))
    const events = await collectEvents(generateResponseStream('你好', 'toxic', [], [], 'req-1', { allowExternal: true, authorizeExternal: authorized }))
    expect(events.at(-1)).toEqual({ type: 'error', reason: 'STREAM_FAILED' })
  })

  it('首句产出前失败且未授权时映射为 CLOUD_NOT_CONSENTED', async () => {
    gatewayStream.mockReturnValue(streamOf([{ type: 'error', reason: 'upstream_error' }]))
    const events = await collectEvents(generateResponseStream('你好', 'toxic', [], [], 'req-1', { allowExternal: false }))
    expect(events).toEqual([{ type: 'error', reason: 'CLOUD_NOT_CONSENTED' }])
  })

  it('工具调用前缀门命中注册工具时产出 toolcall 并中止上游', async () => {
    gatewayStream.mockReturnValue(streamOf([
      { type: 'delta', text: '{"tool":"add_todo","args":{"content":"x"}}' },
    ]))
    const events = await collectEvents(generateResponseStream('帮我记个待办', 'toxic', [], [], 'req-1', { allowExternal: true, authorizeExternal: authorized }))
    expect(events[0]).toMatchObject({ type: 'toolcall', name: 'add_todo' })
  })
})

describe('generateCompanionNote / generateExplanationWithModel 同意门', () => {
  beforeEach(() => {
    gatewayComplete.mockReset()
    resetGatewayCache()
    withCloudEnv()
  })

  it('未同意时短评与解释均抛 CLOUD_NOT_CONSENTED', async () => {
    await expect(generateCompanionNote({ persona: 'toxic', instruction: 'i', userText: 'u' }, 'req-1', { allowExternal: false }))
      .rejects.toThrow(CloudConsentRequiredError)
    await expect(generateExplanationWithModel('p', 'req-1', { allowExternal: false }))
      .rejects.toThrow(CloudConsentRequiredError)
    expect(gatewayComplete).not.toHaveBeenCalled()
  })

  it('已同意时短评来源为 qwen 且经输出过滤', async () => {
    gatewayComplete.mockResolvedValue({ content: '辛苦啦。', provider: 'qwen', model: 'm', scope: 'external' })
    const note = await generateCompanionNote({ persona: 'toxic', instruction: 'i', userText: 'u' }, 'req-1', { allowExternal: true, authorizeExternal: authorized })
    expect(note).toMatchObject({ source: 'qwen', content: '辛苦啦。' })
  })
})
