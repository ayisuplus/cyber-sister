import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  messageFindFirst: vi.fn(),
  memoryFindMany: vi.fn(),
  memoryCreate: vi.fn(),
  getStoredLocalConfig: vi.fn(),
  normalizeAndAuthorizeBaseUrl: vi.fn((url) => url),
  isQwenConfigured: vi.fn(() => false),
  createGateway: vi.fn(),
  gatewayComplete: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    message: { findFirst: mocks.messageFindFirst },
    memory: { findMany: mocks.memoryFindMany, create: mocks.memoryCreate },
  },
}))
vi.mock('./localLlmConfigService.js', () => ({
  getStoredLocalConfig: mocks.getStoredLocalConfig,
  normalizeAndAuthorizeBaseUrl: mocks.normalizeAndAuthorizeBaseUrl,
  isQwenConfigured: mocks.isQwenConfigured,
}))
vi.mock('@cyber-sister/llm-gateway', () => ({ createGateway: mocks.createGateway }))
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { getMemorySuggestions } from './memorySuggestionService.js'

const USER_ID = 'user-1'
const MESSAGE_ID = 'msg-1'
const REQUEST_ID = 'req-1'
const USER_MESSAGE = { id: MESSAGE_ID, role: 'user', content: '我超喜欢吃火锅，每周五都去' }
const LOCAL_CONFIG = { id: 'local', revision: 1, enabled: true, baseUrl: 'http://127.0.0.1:8080/v1', model: 'local-model' }

function modelOutput(items) {
  mocks.gatewayComplete.mockResolvedValue({
    content: JSON.stringify(items),
    provider: 'llamacpp',
    model: 'local-model',
    scope: 'local',
  })
}

const VALID_CANDIDATE = { type: 'semantic', content: '用户喜欢吃火锅', importance: 7, tags: ['饮食'] }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.messageFindFirst.mockResolvedValue(USER_MESSAGE)
  mocks.memoryFindMany.mockResolvedValue([])
  mocks.getStoredLocalConfig.mockResolvedValue(LOCAL_CONFIG)
  mocks.createGateway.mockResolvedValue({ complete: mocks.gatewayComplete })
  modelOutput([VALID_CANDIDATE])
})

describe('记忆建议：归属与输入校验（W3-1）', () => {
  it('只查询当前用户拥有的消息，非本人消息按不存在处理（404）', async () => {
    mocks.messageFindFirst.mockResolvedValue(null)
    await expect(getMemorySuggestions(USER_ID, MESSAGE_ID, REQUEST_ID)).rejects.toMatchObject({
      statusCode: 404,
      message: '消息不存在',
    })
    expect(mocks.messageFindFirst).toHaveBeenCalledWith({
      where: { id: MESSAGE_ID, conversation: { userId: USER_ID } },
    })
    expect(mocks.gatewayComplete).not.toHaveBeenCalled()
  })

  it('拒绝 assistant 消息（400），不调用模型', async () => {
    mocks.messageFindFirst.mockResolvedValue({ ...USER_MESSAGE, role: 'assistant' })
    await expect(getMemorySuggestions(USER_ID, MESSAGE_ID, REQUEST_ID)).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(mocks.gatewayComplete).not.toHaveBeenCalled()
  })

  it('拒绝空 messageId（400）', async () => {
    await expect(getMemorySuggestions(USER_ID, '', REQUEST_ID)).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(mocks.messageFindFirst).not.toHaveBeenCalled()
  })
})

describe('记忆建议：仅本地模型（W3-2）', () => {
  it('本地模型未配置时抛 LOCAL_LLM_NOT_CONFIGURED（503）', async () => {
    mocks.getStoredLocalConfig.mockResolvedValue(null)
    await expect(getMemorySuggestions(USER_ID, MESSAGE_ID, REQUEST_ID)).rejects.toMatchObject({
      code: 'LOCAL_LLM_NOT_CONFIGURED',
      statusCode: 503,
    })
    expect(mocks.gatewayComplete).not.toHaveBeenCalled()
  })

  it('模型不可用（网关返回 null）时抛 LOCAL_LLM_UNAVAILABLE（503），不产生候选', async () => {
    mocks.gatewayComplete.mockResolvedValue(null)
    await expect(getMemorySuggestions(USER_ID, MESSAGE_ID, REQUEST_ID)).rejects.toMatchObject({
      code: 'LOCAL_LLM_UNAVAILABLE',
      statusCode: 503,
    })
  })

  it('网关调用固定 allowExternal=false 且不提供 authorizeExternal（禁止 Qwen 回退）', async () => {
    await getMemorySuggestions(USER_ID, MESSAGE_ID, REQUEST_ID)
    expect(mocks.gatewayComplete).toHaveBeenCalledWith(
      expect.objectContaining({ scene: 'explain', requestId: REQUEST_ID, allowExternal: false }),
    )
    const call = mocks.gatewayComplete.mock.calls[0][0]
    expect(call.authorizeExternal).toBeUndefined()
  })

  it('送入模型的消息经过脱敏', async () => {
    mocks.messageFindFirst.mockResolvedValue({ ...USER_MESSAGE, content: '我手机号13800138000，喜欢火锅' })
    modelOutput([])
    await getMemorySuggestions(USER_ID, MESSAGE_ID, REQUEST_ID)
    const prompt = mocks.gatewayComplete.mock.calls[0][0].messages[0].content
    expect(prompt).toContain('[手机号]')
    expect(prompt).not.toContain('13800138000')
  })
})

describe('记忆建议：候选校验（W3-3）', () => {
  it('模型输出非 JSON 时返回空候选而不是报错', async () => {
    mocks.gatewayComplete.mockResolvedValue({ content: '抱歉，我无法理解', scope: 'local' })
    const result = await getMemorySuggestions(USER_ID, MESSAGE_ID, REQUEST_ID)
    expect(result).toEqual({ candidates: [] })
  })

  it('能从带前后杂文的输出中提取 JSON 数组', async () => {
    mocks.gatewayComplete.mockResolvedValue({
      content: `好的，结果如下：\n${JSON.stringify([VALID_CANDIDATE])}\n以上。`,
      scope: 'local',
    })
    const result = await getMemorySuggestions(USER_ID, MESSAGE_ID, REQUEST_ID)
    expect(result.candidates).toEqual([VALID_CANDIDATE])
  })

  it('字段越界的候选被丢弃，合法候选保留', async () => {
    modelOutput([
      { type: 'diary', content: '类型非法', importance: 5, tags: [] },
      { type: 'semantic', content: '重要程度越界', importance: 99, tags: [] },
      { type: 'semantic', content: '', importance: 5, tags: [] },
      { type: 'semantic', content: 'tags 不是数组', importance: 5, tags: '饮食' },
      VALID_CANDIDATE,
    ])
    const result = await getMemorySuggestions(USER_ID, MESSAGE_ID, REQUEST_ID)
    expect(result.candidates).toEqual([VALID_CANDIDATE])
  })

  it('最多返回 2 项候选', async () => {
    modelOutput([
      { type: 'semantic', content: '候选一', importance: 5, tags: [] },
      { type: 'episodic', content: '候选二', importance: 5, tags: [] },
      { type: 'procedural', content: '候选三', importance: 5, tags: [] },
    ])
    const result = await getMemorySuggestions(USER_ID, MESSAGE_ID, REQUEST_ID)
    expect(result.candidates).toHaveLength(2)
  })

  it('与现有记忆规范化精确去重（忽略首尾空白与大小写）', async () => {
    mocks.memoryFindMany.mockResolvedValue([{ content: '用户喜欢吃火锅' }])
    modelOutput([
      { type: 'semantic', content: '  用户喜欢吃火锅 ', importance: 7, tags: ['饮食'] },
      { type: 'semantic', content: '用户每周五吃火锅', importance: 6, tags: ['饮食'] },
    ])
    const result = await getMemorySuggestions(USER_ID, MESSAGE_ID, REQUEST_ID)
    expect(result.candidates).toEqual([
      { type: 'semantic', content: '用户每周五吃火锅', importance: 6, tags: ['饮食'] },
    ])
  })

  it('候选之间也去重', async () => {
    modelOutput([
      { type: 'semantic', content: '用户喜欢火锅', importance: 5, tags: [] },
      { type: 'semantic', content: '用户喜欢火锅', importance: 8, tags: ['重复'] },
    ])
    const result = await getMemorySuggestions(USER_ID, MESSAGE_ID, REQUEST_ID)
    expect(result.candidates).toHaveLength(1)
  })
})

describe('记忆建议：敏感排除（W3-4）', () => {
  it('输入命中危机检测时不生成候选，也不调用模型', async () => {
    mocks.messageFindFirst.mockResolvedValue({ ...USER_MESSAGE, content: '我不想活了' })
    const result = await getMemorySuggestions(USER_ID, MESSAGE_ID, REQUEST_ID)
    expect(result).toEqual({ candidates: [] })
    expect(mocks.gatewayComplete).not.toHaveBeenCalled()
  })

  it('候选含联系方式（手机号）时不生成任何候选', async () => {
    modelOutput([
      { type: 'semantic', content: '用户手机号是13800138000', importance: 5, tags: [] },
      VALID_CANDIDATE,
    ])
    const result = await getMemorySuggestions(USER_ID, MESSAGE_ID, REQUEST_ID)
    expect(result).toEqual({ candidates: [] })
  })

  it('候选含证件号时不生成任何候选', async () => {
    modelOutput([{ type: 'semantic', content: '身份证号110101199003077777', importance: 5, tags: [] }])
    const result = await getMemorySuggestions(USER_ID, MESSAGE_ID, REQUEST_ID)
    expect(result).toEqual({ candidates: [] })
  })

  it('候选含精确位置时不生成任何候选', async () => {
    modelOutput([{ type: 'episodic', content: '用户家住在北京市朝阳区幸福路123号', importance: 5, tags: [] }])
    const result = await getMemorySuggestions(USER_ID, MESSAGE_ID, REQUEST_ID)
    expect(result).toEqual({ candidates: [] })
  })

  it('候选含医疗内容时不生成任何候选', async () => {
    modelOutput([{ type: 'episodic', content: '用户确诊抑郁症后开始服药', importance: 5, tags: [] }])
    const result = await getMemorySuggestions(USER_ID, MESSAGE_ID, REQUEST_ID)
    expect(result).toEqual({ candidates: [] })
  })

  it('候选含全角标点（NFKC 差分）时不再被误判为敏感', async () => {
    modelOutput([{ type: 'semantic', content: '用户特别喜欢桂花味的香水，购买时按此口味挑选', importance: 8, tags: ['香水', '桂花'] }])
    const result = await getMemorySuggestions(USER_ID, MESSAGE_ID, REQUEST_ID)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].content).toContain('桂花味')
  })
})

describe('记忆建议：非持久化（W3-5）', () => {
  it('整条链路不写 Memory 表，候选只存在于响应体', async () => {
    const result = await getMemorySuggestions(USER_ID, MESSAGE_ID, REQUEST_ID)
    expect(result.candidates).toEqual([VALID_CANDIDATE])
    expect(mocks.memoryCreate).not.toHaveBeenCalled()
  })
})
