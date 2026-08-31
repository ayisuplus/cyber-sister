import { beforeEach, describe, expect, it, vi } from 'vitest'

const gatewayComplete = vi.hoisted(() => vi.fn())

vi.mock('@cyber-sister/llm-gateway', () => ({
  createGateway: vi.fn(() => Promise.resolve({
    complete: gatewayComplete,
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
  LlmUnavailableError,
  redactSensitiveText,
  retrieveRelevantMemories,
} from './llmService.js'

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

  it('妆教解释也把外部授权复核钩子原样交给网关', async () => {
    const authorizeExternal = vi.fn(() => true)
    gatewayComplete.mockResolvedValue({
      content: '一句解释',
      provider: 'qwen',
      model: 'configured-model',
      scope: 'external',
    })

    await expect(generateExplanationWithModel(
      '规范化妆教提示',
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

  it('本地模板支持三种当前人格并明确标识来源', () => {
    for (const persona of ['toxic', 'gentle', 'rational']) {
      expect(generateLocalTemplateResponse('今天有点焦虑', persona))
        .toMatchObject({ source: 'local_template', emotion: 'anxious' })
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
