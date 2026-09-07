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

vi.mock('./localLlmConfigService.js', () => ({
  getStoredLocalConfig: vi.fn(() => Promise.resolve({
    id: 'local',
    enabled: true,
    revision: 1,
    baseUrl: 'http://llama:8080/v1',
    model: 'local-model',
  })),
  isQwenConfigured: vi.fn(() => true),
  normalizeAndAuthorizeBaseUrl: vi.fn((value) => value),
}))

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  buildMemoryContext,
  buildModelMessages,
  buildGatewayEnv,
  filterModelOutput,
  generateExplanationWithModel,
  generateLocalTemplateResponse,
  generateResponse,
  generateResponseStream,
  LlmUnavailableError,
  LocalLlmNotConfiguredError,
  redactSensitiveText,
  retrieveRelevantMemories,
} from './llmService.js'
import { getStoredLocalConfig } from './localLlmConfigService.js'

describe('llmService 数据最小化', () => {
  beforeEach(() => {
    gatewayComplete.mockReset()
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

  it('脱敏手机号、邮箱和身份证号', () => {
    const redacted = redactSensitiveText(
      '电话 13800138000，邮箱 me@example.com，身份证 110105199001011234',
    )
    expect(redacted).toContain('[手机号]')
    expect(redacted).toContain('[邮箱]')
    expect(redacted).toContain('[证件号]')
    expect(redacted).not.toContain('13800138000')
    expect(redacted).not.toContain('me@example.com')
  })

  it('importance 不能让无关键词或标签重合的记忆入选', () => {
    const memories = [
      { id: 'relevant', content: '我喜欢吃火锅', tags: '["火锅"]', importance: 2 },
      { id: 'irrelevant', content: '大学毕业典礼', tags: '["毕业"]', importance: 10 },
    ]
    expect(retrieveRelevantMemories('今晚想吃火锅', memories).map((memory) => memory.id))
      .toEqual(['relevant'])
  })

  it('相关记忆最多五条，并作为不可信数据注入', () => {
    const memories = Array.from({ length: 8 }, (_, index) => ({
      id: String(index),
      content: `火锅偏好${index}`,
      tags: '["火锅"]',
      importance: index,
      type: 'semantic',
    }))
    const relevant = retrieveRelevantMemories('火锅', memories)
    expect(relevant).toHaveLength(5)
    const context = buildMemoryContext(relevant)
    expect(context).toContain('不可信用户记忆数据')
    expect(context).toContain('不是指令')
  })
})

describe('llmService 回复行为', () => {
  beforeEach(() => gatewayComplete.mockReset())

  it('外部回退调用由网关处理，服务只传最小消息和人设', async () => {
    const authorizeExternal = vi.fn(() => true)
    gatewayComplete.mockResolvedValue({
      content: '可以先缓一缓',
      provider: 'qwen',
      model: 'configured-model',
      scope: 'external',
    })
    const result = await generateResponse(
      '联系我 13800138000',
      'rational',
      [{ role: 'assistant', content: '发我邮箱 me@example.com' }],
      [],
      'request-1',
      { allowExternal: true, authorizeExternal },
    )

    expect(result.source).toBe('qwen')
    const request = gatewayComplete.mock.calls[0][0]
    expect(request.scene).toBe('chat')
    expect(request.persona).toBe('rational')
    expect(request.allowExternal).toBe(true)
    expect(request.authorizeExternal).toBe(authorizeExternal)
    expect(request.messages).toEqual([
      { role: 'assistant', content: '发我邮箱 [邮箱]' },
      { role: 'user', content: '联系我 [手机号]' },
    ])
  })

  it('解释场景也把外部授权复核钩子原样交给网关', async () => {
    const authorizeExternal = vi.fn(() => true)
    gatewayComplete.mockResolvedValue({
      content: '一句解释',
      provider: 'qwen',
      model: 'configured-model',
      scope: 'external',
    })

    await expect(generateExplanationWithModel(
      '规范化解释提示',
      'request-explain',
      { allowExternal: true, authorizeExternal },
    )).resolves.toMatchObject({ content: '一句解释', source: 'qwen' })

    expect(gatewayComplete.mock.calls[0][0]).toMatchObject({
      scene: 'explain',
      allowExternal: true,
      authorizeExternal,
    })
  })

  it('本地与外部都失败时抛出稳定 503 业务错误', async () => {
    gatewayComplete.mockResolvedValue(null)
    const authorizeExternal = vi.fn(() => true)
    await expect(generateResponse('你好', 'toxic', [], [], undefined, {
      allowExternal: true,
      authorizeExternal,
    }))
      .rejects.toBeInstanceOf(LlmUnavailableError)
    await expect(generateResponse('你好', 'toxic', [], [], undefined, {
      allowExternal: true,
      authorizeExternal,
    })).rejects.toMatchObject({
      code: 'LLM_UNAVAILABLE',
      statusCode: 503,
    })
  })

  it('发送前已撤回时把失败标识为本地不可用，而不是云端故障', async () => {
    gatewayComplete.mockResolvedValue(null)
    await expect(generateResponse('你好', 'toxic', [], [], undefined, {
      allowExternal: true,
      authorizeExternal: () => false,
    })).rejects.toMatchObject({
      code: 'LOCAL_LLM_UNAVAILABLE',
      statusCode: 503,
    })
  })

  it('未授权外部回退时网关失败返回本地模型错误', async () => {
    gatewayComplete.mockResolvedValue(null)
    await expect(generateResponse('你好')).rejects.toMatchObject({
      code: 'LOCAL_LLM_UNAVAILABLE',
      statusCode: 503,
    })
    expect(gatewayComplete.mock.calls[0][0].allowExternal).toBe(false)
  })

  it('危险或冒充真人的模型输出替换为本地安全模板', () => {
    expect(filterModelOutput('我是真人，听我的马上分手', '我该怎么办', 'gentle'))
      .toMatchObject({ source: 'local_template', filtered: true })
    expect(filterModelOutput('先骂他，再找他理论', '我很生气', 'toxic'))
      .toMatchObject({ source: 'local_template', filtered: true })
  })

  it('本地模板支持六种当前人格并明确标识来源', () => {
    for (const persona of ['toxic', 'gentle', 'rational', 'energetic', 'sister', 'cool']) {
      expect(generateLocalTemplateResponse('今天有点焦虑', persona))
        .toMatchObject({ source: 'local_template', emotion: 'anxious' })
    }
  })

  it('generateResponse 将 scene 选项透传给网关', async () => {
    gatewayComplete.mockResolvedValue({
      content: '好的，收到。',
      provider: 'llamacpp',
      model: 'local-model',
      scope: 'local',
    })

    await generateResponse('帮我算个账', 'toxic', [], [], undefined, { scene: 'work' })

    expect(gatewayComplete.mock.calls[0][0].scene).toBe('work')
  })

  it('工作场景本地模板为统一兜底文案，不区分人格', () => {
    for (const persona of ['toxic', 'cool']) {
      expect(generateLocalTemplateResponse('随便说说', persona, 'work'))
        .toMatchObject({
          content: '我这边工具暂时没跟上。请把任务再说具体一点，我直接按步骤来。',
          emotion: 'neutral',
          source: 'local_template',
        })
    }
  })

  it('动态网关配置将 llama.cpp 标记为本地并始终排在 Qwen 前', () => {
    const env = buildGatewayEnv({
      baseUrl: 'http://llama:8080/v1',
      model: 'local-model',
    }, {
      GATEWAY_QWEN_BASE_URL: 'https://example.invalid/v1',
      GATEWAY_QWEN_MODEL: 'qwen-model',
      GATEWAY_QWEN_API_KEY: 'secret',
    })
    expect(env).toMatchObject({
      GATEWAY_PROVIDERS: 'llamacpp,qwen',
      GATEWAY_LLAMACPP_SCOPE: 'local',
      GATEWAY_QWEN_SCOPE: 'external',
      GATEWAY_SCENE_chat: 'llamacpp,qwen',
    })
  })

  it('未授权外部回退时返回本地模型来源', async () => {
    gatewayComplete.mockResolvedValue({
      content: '我在，我们慢慢说。',
      provider: 'llamacpp',
      model: 'local-model',
      scope: 'local',
    })
    const result = await generateResponse('今天有点累')
    expect(result).toMatchObject({ source: 'local_model', provider: 'llamacpp' })
    expect(gatewayComplete.mock.calls[0][0].allowExternal).toBe(false)
  })
})

function streamOf(events) {
  return (async function* () {
    for (const event of events) yield event
  })()
}

async function collectEvents(iterable) {
  const events = []
  for await (const event of iterable) events.push(event)
  return events
}

describe('llmService.generateResponseStream 分句安全输出', () => {
  beforeEach(() => {
    gatewayComplete.mockReset()
    gatewayStream.mockReset()
  })

  it('跨 delta 按终止符分句，无终止符尾段随流结束产出', async () => {
    gatewayStream.mockReturnValue(streamOf([
      { type: 'delta', text: '第一句。第二' },
      { type: 'delta', text: '句！还有问吗？尾段没有终止符' },
      { type: 'done', provider: 'llamacpp', model: 'local-model', scope: 'local' },
    ]))

    const events = await collectEvents(generateResponseStream('你好', 'toxic', [], [], 'req-1'))

    expect(events.map((event) => event.type)).toEqual([
      'sentence', 'sentence', 'sentence', 'sentence', 'done',
    ])
    expect(events.slice(0, 4).map((event) => event.text)).toEqual([
      '第一句。', '第二句！', '还有问吗？', '尾段没有终止符',
    ])
    expect(events[4]).toMatchObject({
      // done.content 与 filterModelOutput 一致经过 NFKC 归一化（！→! ？→?）
      content: '第一句。第二句!还有问吗?尾段没有终止符',
      source: 'local_model',
      provider: 'llamacpp',
      model: 'local-model',
    })
  })

  it('整段无终止符时不发 sentence，只在 done 给出完整内容', async () => {
    gatewayStream.mockReturnValue(streamOf([
      { type: 'delta', text: '没有句号的一段话' },
      { type: 'done', provider: 'llamacpp', model: 'local-model', scope: 'local' },
    ]))

    const events = await collectEvents(generateResponseStream('你好'))

    expect(events.map((event) => event.type)).toEqual(['sentence', 'done'])
    expect(events[0]).toEqual({ type: 'sentence', text: '没有句号的一段话' })
    expect(events[1]).toMatchObject({ content: '没有句号的一段话', source: 'local_model' })
  })

  it('累计安全检查命中时中止上游、发 replace 并以本地模板收尾', async () => {
    let fullyConsumed = false
    let generatorClosed = false
    gatewayStream.mockReturnValue((async function* () {
      try {
        yield { type: 'delta', text: '这句话没问题。' }
        yield { type: 'delta', text: '不如直接打死他。' }
        yield { type: 'delta', text: '不该到达的内容。' }
        yield { type: 'done', provider: 'llamacpp', model: 'local-model', scope: 'local' }
        fullyConsumed = true
      } finally {
        generatorClosed = true
      }
    })())

    const events = await collectEvents(generateResponseStream('我很生气', 'toxic', [], [], 'req-2'))
    const template = generateLocalTemplateResponse('我很生气', 'toxic')

    expect(events.map((event) => event.type)).toEqual(['sentence', 'replace', 'done'])
    expect(events[0]).toEqual({ type: 'sentence', text: '这句话没问题。' })
    expect(events[1]).toEqual({
      type: 'replace',
      content: template.content,
      source: 'local_template',
    })
    expect(events[2]).toMatchObject({
      content: template.content,
      emotion: template.emotion,
      source: 'local_template',
    })
    // 上游被中止：后续 delta 不再被消费
    expect(fullyConsumed).toBe(false)
    expect(generatorClosed).toBe(true)
  })

  it('未配置本地模型时产出 LOCAL_LLM_NOT_CONFIGURED 且不调用网关', async () => {
    getStoredLocalConfig.mockResolvedValueOnce(null)

    const events = await collectEvents(generateResponseStream('你好'))

    expect(events).toEqual([{ type: 'error', reason: 'LOCAL_LLM_NOT_CONFIGURED' }])
    expect(gatewayStream).not.toHaveBeenCalled()
  })

  it('首句产出前失败且未授权外部回退时映射为 LOCAL_LLM_UNAVAILABLE', async () => {
    gatewayStream.mockReturnValue(streamOf([{ type: 'error', reason: 'all_providers_failed' }]))

    const events = await collectEvents(generateResponseStream('你好', 'toxic', [], [], 'req-3', {
      allowExternal: true,
      authorizeExternal: () => false,
    }))

    expect(events).toEqual([{ type: 'error', reason: 'LOCAL_LLM_UNAVAILABLE' }])
  })

  it('首句产出前失败且已授权外部回退时映射为 LLM_UNAVAILABLE', async () => {
    gatewayStream.mockReturnValue(streamOf([{ type: 'error', reason: 'all_providers_failed' }]))

    const events = await collectEvents(generateResponseStream('你好', 'toxic', [], [], 'req-4', {
      allowExternal: true,
      authorizeExternal: () => true,
    }))

    expect(events).toEqual([{ type: 'error', reason: 'LLM_UNAVAILABLE' }])
  })

  it('首句产出后的上游失败只报 STREAM_FAILED 且事件不含对话内容', async () => {
    gatewayStream.mockReturnValue(streamOf([
      { type: 'delta', text: '这句已经安全发出。' },
      { type: 'error', reason: 'upstream_error' },
    ]))

    const events = await collectEvents(generateResponseStream('你好'))

    expect(events).toEqual([
      { type: 'sentence', text: '这句已经安全发出。' },
      { type: 'error', reason: 'STREAM_FAILED' },
    ])
    expect(JSON.stringify(events.at(-1))).not.toContain('这句已经安全发出')
  })

  it('同意装配、最小消息与取消信号原样转发给网关流', async () => {
    const authorizeExternal = vi.fn(() => true)
    const caller = new AbortController()
    gatewayStream.mockReturnValue(streamOf([
      { type: 'delta', text: '好。' },
      { type: 'done', provider: 'qwen', model: 'qwen-model', scope: 'external' },
    ]))

    const events = await collectEvents(generateResponseStream(
      '联系我 13800138000',
      'rational',
      [{ role: 'assistant', content: '发我邮箱 me@example.com' }],
      [],
      'req-5',
      { allowExternal: true, authorizeExternal, signal: caller.signal },
    ))

    expect(events.at(-1)).toMatchObject({ source: 'qwen', provider: 'qwen', model: 'qwen-model' })
    const request = gatewayStream.mock.calls[0][0]
    expect(request.scene).toBe('chat')
    expect(request.persona).toBe('rational')
    expect(request.allowExternal).toBe(true)
    expect(request.authorizeExternal).toBe(authorizeExternal)
    expect(request.messages).toEqual([
      { role: 'assistant', content: '发我邮箱 [邮箱]' },
      { role: 'user', content: '联系我 [手机号]' },
    ])
    expect(request.signal.aborted).toBe(false)
  })

  it('调用方取消时中止上游并安静结束', async () => {
    const caller = new AbortController()
    let gatewaySignal
    gatewayStream.mockImplementation(({ signal: upstreamSignal }) => {
      gatewaySignal = upstreamSignal
      return (async function* () {
        yield { type: 'delta', text: '没有终止符的半句' }
        // 网关契约：abort 后安静结束，不再产出任何事件
        await new Promise((resolve) => {
          if (upstreamSignal.aborted) resolve()
          else upstreamSignal.addEventListener('abort', resolve, { once: true })
        })
      })()
    })

    const stream = generateResponseStream('你好', 'toxic', [], [], 'req-6', { signal: caller.signal })
    const pending = stream.next()
    caller.abort()
    const result = await pending

    expect(result.done).toBe(true)
    expect(gatewaySignal.aborted).toBe(true)
  })
})

describe('llmService.generateResponseStream 工具调用前缀门', () => {
  beforeEach(() => {
    gatewayComplete.mockReset()
    gatewayStream.mockReset()
  })

  it('拦截跨分片到达的注册工具调用：中止上游、不产生任何 sentence', async () => {
    let fullyConsumed = false
    gatewayStream.mockReturnValue((async function* () {
      try {
        yield { type: 'delta', text: '  {"tool":"add_todo","ar' }
        yield { type: 'delta', text: 'gs":{"content":"周六复诊。带句号"}}' }
        yield { type: 'delta', text: '不该到达的内容。' }
        yield { type: 'done', provider: 'llamacpp', model: 'local-model', scope: 'local' }
        fullyConsumed = true
      } finally {
        // 上游被提前退出时 finally 一定运行（生成器关闭）
      }
    })())

    const events = await collectEvents(generateResponseStream('帮我记个待办', 'toxic', [], [], 'req-tool-1'))

    expect(events).toEqual([{ type: 'toolcall', name: 'add_todo', args: { content: '周六复诊。带句号' } }])
    expect(fullyConsumed).toBe(false)
  })

  it('JSON 形但非注册工具的前缀按自然语言放行', async () => {
    gatewayStream.mockReturnValue(streamOf([
      { type: 'delta', text: '{"心情":"不错"} 这是 JSON 样式。' },
      { type: 'done', provider: 'llamacpp', model: 'local-model', scope: 'local' },
    ]))

    const events = await collectEvents(generateResponseStream('你好'))

    expect(events[0]).toEqual({ type: 'sentence', text: '{"心情":"不错"} 这是 JSON 样式。' })
    expect(events.at(-1)).toMatchObject({ type: 'done', source: 'local_model' })
  })

  it('extraSystem 原样并入 systemAppend 转发给网关', async () => {
    let request
    gatewayStream.mockImplementation((req) => {
      request = req
      return streamOf([{ type: 'delta', text: '好。' }, { type: 'done', provider: 'llamacpp', model: 'm', scope: 'local' }])
    })

    await collectEvents(generateResponseStream('你好', 'toxic', [], [], 'req-tool-2', {
      extraSystem: [{ role: 'system', content: '工具提示词' }],
    }))

    expect(request.systemAppend).toEqual([{ role: 'system', content: '工具提示词' }])
  })
})

describe('llmService 外部主用部署模式（EXTERNAL_CHAT_PRIMARY）', () => {
  beforeEach(() => {
    gatewayComplete.mockReset()
    gatewayStream.mockReset()
    delete process.env.EXTERNAL_CHAT_PRIMARY
  })

  const withPrimary = async (fn) => {
    process.env.EXTERNAL_CHAT_PRIMARY = 'true'
    try { return await fn() } finally { delete process.env.EXTERNAL_CHAT_PRIMARY }
  }

  it('默认部署保持本地优先的场景路由顺序', () => {
    const env = buildGatewayEnv({ baseUrl: 'http://llama:8080/v1', model: 'local-model' }, {})
    expect(env.GATEWAY_SCENE_chat).toBe('llamacpp,qwen')
  })

  it('外部主用时场景路由外部优先，且允许无本地配置', () => {
    const env = buildGatewayEnv(null, { EXTERNAL_CHAT_PRIMARY: 'true' })
    expect(env.GATEWAY_PROVIDERS).toBe('qwen')
    expect(env.GATEWAY_SCENE_chat).toBe('qwen')
    expect(env.GATEWAY_SCENE_explain).toBe('qwen')
  })

  it('外部主用时未配置本地模型也能完成非流式回复', () => withPrimary(async () => {
    getStoredLocalConfig.mockResolvedValueOnce(null)
    gatewayComplete.mockResolvedValue({ content: '云端回复', provider: 'qwen', model: 'dots', scope: 'external' })

    const result = await generateResponse('你好', 'toxic', [], [], 'req-ext-1', {
      allowExternal: true,
      authorizeExternal: async () => true,
    })

    expect(result.content).toBe('云端回复')
    expect(result.source).toBe('qwen')
  }))

  it('默认模式下未配置本地模型仍然抛 LOCAL_LLM_NOT_CONFIGURED', async () => {
    getStoredLocalConfig.mockResolvedValueOnce(null)

    await expect(generateResponse('你好', 'toxic', [], [], 'req-ext-2')).rejects.toThrow(LocalLlmNotConfiguredError)
    expect(gatewayComplete).not.toHaveBeenCalled()
  })

  it('外部主用时流式正常产出而不是 NOT_CONFIGURED 错误', () => withPrimary(async () => {
    getStoredLocalConfig.mockResolvedValueOnce(null)
    gatewayStream.mockReturnValue(streamOf([
      { type: 'delta', text: '云端好。' },
      { type: 'done', provider: 'qwen', model: 'dots', scope: 'external' },
    ]))

    const events = await collectEvents(generateResponseStream('你好', 'toxic', [], [], 'req-ext-3', {
      allowExternal: true,
      authorizeExternal: async () => true,
    }))

    expect(events.map((event) => event.type)).toEqual(['sentence', 'done'])
    expect(events[1]).toMatchObject({ content: '云端好。', source: 'qwen' })
  }))
})
