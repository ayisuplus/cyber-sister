import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  conversationFindFirst: vi.fn(),
  conversationFindMany: vi.fn(),
  conversationCreate: vi.fn(),
  conversationDelete: vi.fn(),
  conversationUpdate: vi.fn(),
  messageFindMany: vi.fn(),
  messageCreate: vi.fn(),
  memoryFindMany: vi.fn(),
  crisisCreate: vi.fn(),
  transaction: vi.fn(),
  generateResponse: vi.fn(),
  detectCrisis: vi.fn(),
}))

vi.mock('../prisma/client.js', () => {
  const tx = {
    message: { create: mocks.messageCreate },
    conversation: { update: mocks.conversationUpdate },
    crisisLog: { create: mocks.crisisCreate },
  }
  return {
    default: {
      user: { findUnique: mocks.userFindUnique },
      conversation: {
        findFirst: mocks.conversationFindFirst,
        findMany: mocks.conversationFindMany,
        create: mocks.conversationCreate,
        update: mocks.conversationUpdate,
        delete: mocks.conversationDelete,
      },
      message: { findMany: mocks.messageFindMany },
      memory: { findMany: mocks.memoryFindMany },
      $transaction: mocks.transaction.mockImplementation((callback) => callback(tx)),
    },
  }
})

vi.mock('./llmService.js', () => ({
  generateResponse: mocks.generateResponse,
  detectCrisis: mocks.detectCrisis,
}))

vi.mock('./detection.js', () => ({
  getCrisisIntervention: (level) => ({
    level,
    message: '固定安全干预',
    resources: [{ type: 'trusted_person', label: '联系信任的人', guidance: '请尽快联系' }],
  }),
}))

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  sendMessage,
} from './chatService.js'
import { EXTERNAL_LLM_CONSENT_VERSION } from './userService.js'

describe('chatService 会话管理', () => {
  beforeEach(() => vi.clearAllMocks())

  it('按更新时间倒序列出会话并附最近一条消息，默认第一页 20 条', async () => {
    mocks.conversationFindMany.mockResolvedValue([{ id: 'c1', messages: [] }])
    const result = await listConversations('user-1')
    expect(mocks.conversationFindMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { updatedAt: 'desc' },
      skip: 0,
      take: 20,
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    })
    expect(result).toHaveLength(1)
  })

  it('会话列表分页参数生效且 limit 封顶 50', async () => {
    mocks.conversationFindMany.mockResolvedValue([])

    await listConversations('user-1', { page: 3, limit: 10 })
    expect(mocks.conversationFindMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 20,
      take: 10,
    }))

    await listConversations('user-1', { page: -1, limit: 999 })
    expect(mocks.conversationFindMany).toHaveBeenLastCalledWith(expect.objectContaining({
      skip: 0,
      take: 50,
    }))
  })

  it('新建会话缺省标题为赛博姐妹', async () => {
    mocks.conversationCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'c1', ...data }))

    const withDefault = await createConversation('user-1')
    expect(withDefault.title).toBe('赛博姐妹')

    const withTitle = await createConversation('user-1', { title: '倾诉' })
    expect(withTitle.title).toBe('倾诉')
  })

  it('会话详情按归属查询并分页消息，不存在抛 404', async () => {
    mocks.conversationFindFirst.mockResolvedValue({ id: 'c1', userId: 'user-1', messages: [] })
    const detail = await getConversation('c1', 'user-1')
    expect(mocks.conversationFindFirst).toHaveBeenCalledWith({
      where: { id: 'c1', userId: 'user-1' },
      include: { messages: { orderBy: { createdAt: 'asc' }, skip: 0, take: 50 } },
    })
    expect(detail.id).toBe('c1')

    await getConversation('c1', 'user-1', { page: 2, limit: 30 })
    expect(mocks.conversationFindFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      include: { messages: { orderBy: { createdAt: 'asc' }, skip: 30, take: 30 } },
    }))

    // limit 超过 100 封顶
    await getConversation('c1', 'user-1', { limit: 5000 })
    expect(mocks.conversationFindFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      include: { messages: { orderBy: { createdAt: 'asc' }, skip: 0, take: 100 } },
    }))

    mocks.conversationFindFirst.mockResolvedValue(null)
    await expect(getConversation('c1', 'other-user')).rejects.toMatchObject({
      statusCode: 404,
      message: '会话不存在',
    })
  })

  it('删除会话前校验归属，无权访问不写库', async () => {
    mocks.conversationFindFirst.mockResolvedValue({ id: 'c1', userId: 'user-1' })
    await deleteConversation('c1', 'user-1')
    expect(mocks.conversationDelete).toHaveBeenCalledWith({ where: { id: 'c1' } })

    mocks.conversationFindFirst.mockResolvedValue(null)
    await expect(deleteConversation('c1', 'other-user')).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.conversationDelete).toHaveBeenCalledTimes(1)
  })
})

describe('chatService.sendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.transaction.mockImplementation((callback) => callback({
      message: { create: mocks.messageCreate },
      conversation: { update: mocks.conversationUpdate },
      crisisLog: { create: mocks.crisisCreate },
    }))
    mocks.conversationFindFirst.mockResolvedValue({ id: 'conversation-1', userId: 'user-1' })
    mocks.userFindUnique.mockResolvedValue({
      persona: 'toxic',
      externalLlmConsent: true,
      externalLlmConsentVersion: EXTERNAL_LLM_CONSENT_VERSION,
    })
    mocks.detectCrisis.mockReturnValue(null)
    mocks.messageFindMany.mockResolvedValue([])
    mocks.memoryFindMany.mockResolvedValue([])
    mocks.messageCreate.mockImplementation(({ data }) => Promise.resolve({
      id: data.role === 'user' ? 'user-message' : 'ai-message',
      ...data,
    }))
    mocks.conversationUpdate.mockResolvedValue({})
    mocks.crisisCreate.mockResolvedValue({ id: 'crisis-1' })
    mocks.generateResponse.mockResolvedValue({
      content: '模型回复',
      emotion: 'neutral',
      source: 'local_model',
      provider: 'llamacpp',
      model: 'configured-model',
    })
  })

  it('同意未决时仍调用本地模型，且禁止外部回退', async () => {
    mocks.userFindUnique.mockResolvedValue({
      persona: 'toxic',
      externalLlmConsent: null,
      externalLlmConsentVersion: null,
    })

    const result = await sendMessage('conversation-1', 'user-1', '你好')
    expect(result).toMatchObject({ status: 'ok', source: 'local_model' })
    expect(mocks.generateResponse).toHaveBeenCalledWith(
      '你好', 'toxic', [], [], undefined, { allowExternal: false },
    )
    expect(mocks.messageCreate).toHaveBeenCalledTimes(2)
  })

  it('拒绝外部模型时使用本地模型且禁止外部回退', async () => {
    mocks.userFindUnique.mockResolvedValue({
      persona: 'gentle',
      externalLlmConsent: false,
      externalLlmConsentVersion: EXTERNAL_LLM_CONSENT_VERSION,
    })

    const result = await sendMessage('conversation-1', 'user-1', '你好')
    expect(result).toMatchObject({ status: 'ok', source: 'local_model' })
    expect(mocks.generateResponse).toHaveBeenCalledWith(
      '你好', 'gentle', [], [], undefined, { allowExternal: false },
    )
    expect(mocks.messageCreate).toHaveBeenCalledTimes(2)
  })

  it('接受后只把最近 19 条历史按旧到新传入，当前消息不重复', async () => {
    const descending = Array.from({ length: 19 }, (_, index) => ({
      role: index % 2 ? 'user' : 'assistant',
      content: `倒序${index}`,
    }))
    mocks.messageFindMany.mockResolvedValue(descending)
    mocks.memoryFindMany.mockResolvedValue([{ content: '喜欢火锅', type: 'semantic', importance: 5, tags: '["火锅"]' }])

    const result = await sendMessage('conversation-1', 'user-1', '当前消息')
    expect(result).toMatchObject({ status: 'ok', source: 'local_model' })
    expect(mocks.generateResponse).toHaveBeenCalledOnce()
    const [current, persona, history, memories] = mocks.generateResponse.mock.calls[0]
    expect(current).toBe('当前消息')
    expect(persona).toBe('toxic')
    expect(history).toEqual([...descending].reverse())
    expect(history).not.toContainEqual(expect.objectContaining({ content: '当前消息' }))
    expect(memories).toHaveLength(1)
    expect(mocks.generateResponse.mock.calls[0][5]).toEqual({
      allowExternal: true,
      authorizeExternal: expect.any(Function),
    })
    expect(mocks.messageCreate).toHaveBeenCalledTimes(2)
  })
  it('注入提示词的记忆按重要度排序并封顶 200 条', async () => {
    await sendMessage('conversation-1', 'user-1', '你好')

    expect(mocks.memoryFindMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
    }))
  })

  it('本地模型等待期间撤回同意时，发送前复核会阻止外部请求', async () => {
    let releaseLocal
    const localFinished = new Promise((resolve) => { releaseLocal = resolve })
    const externalFetch = vi.fn()
    mocks.generateResponse.mockImplementation(async (...args) => {
      await localFinished
      const { authorizeExternal } = args[5]
      if (await authorizeExternal()) externalFetch()
      throw Object.assign(new Error('本地模型不可用'), {
        code: 'LOCAL_LLM_UNAVAILABLE',
        statusCode: 503,
      })
    })

    const pending = sendMessage('conversation-1', 'user-1', '别发到云端')
    await vi.waitFor(() => expect(mocks.generateResponse).toHaveBeenCalledOnce())
    mocks.userFindUnique.mockResolvedValue({
      persona: 'toxic',
      externalLlmConsent: false,
      externalLlmConsentVersion: EXTERNAL_LLM_CONSENT_VERSION,
    })
    releaseLocal()

    await expect(pending).rejects.toMatchObject({ code: 'LOCAL_LLM_UNAVAILABLE' })
    expect(mocks.userFindUnique).toHaveBeenCalledTimes(2)
    expect(externalFetch).not.toHaveBeenCalled()
    expect(mocks.messageCreate).not.toHaveBeenCalled()
  })

  it('外部模型失败时不保存当前消息', async () => {
    const error = Object.assign(new Error('暂不可用'), {
      code: 'LLM_UNAVAILABLE',
      statusCode: 503,
    })
    mocks.generateResponse.mockRejectedValue(error)

    await expect(sendMessage('conversation-1', 'user-1', '重试我')).rejects.toMatchObject({
      code: 'LLM_UNAVAILABLE',
      statusCode: 503,
    })
    expect(mocks.messageCreate).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('中高风险先于同意与模型调用，并在一个事务中只写一条 CrisisLog', async () => {
    mocks.detectCrisis.mockReturnValue('high')

    const result = await sendMessage('conversation-1', 'user-1', '我不想活了')
    expect(result).toMatchObject({
      status: 'blocked',
      intervention: { level: 'high', message: '固定安全干预' },
    })
    expect(mocks.userFindUnique).not.toHaveBeenCalled()
    expect(mocks.generateResponse).not.toHaveBeenCalled()
    expect(mocks.transaction).toHaveBeenCalledOnce()
    expect(mocks.messageCreate).toHaveBeenCalledTimes(2)
    expect(mocks.crisisCreate).toHaveBeenCalledOnce()
    expect(mocks.crisisCreate).toHaveBeenCalledWith({
      data: { userId: 'user-1', triggerMsg: null, level: 'high', handled: true },
    })
  })
  it('会话归属通过后用户已不存在时抛 404，不调用模型', async () => {
    mocks.userFindUnique.mockResolvedValue(null)

    await expect(sendMessage('conversation-1', 'user-1', '你好')).rejects.toMatchObject({
      statusCode: 404,
      message: '用户不存在',
    })
    expect(mocks.generateResponse).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
