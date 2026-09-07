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
  generateResponseStream: vi.fn(),
  generateLocalTemplateResponse: vi.fn(),
  generateCompanionNote: vi.fn(),
  retrieveRelevantMemories: vi.fn(() => []),
  executeToolCall: vi.fn(),
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
  generateResponseStream: mocks.generateResponseStream,
  generateLocalTemplateResponse: mocks.generateLocalTemplateResponse,
  generateCompanionNote: mocks.generateCompanionNote,
  retrieveRelevantMemories: mocks.retrieveRelevantMemories,
  MAX_MEMORY_CHARS: 240,
  detectCrisis: mocks.detectCrisis,
}))

vi.mock('./agentService.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, executeToolCall: mocks.executeToolCall, executeToolCallOnce: mocks.executeToolCall }
})

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
  sendMessageStream,
} from './chatService.js'
import { EXTERNAL_LLM_CONSENT_VERSION } from './userService.js'

describe('chatService 会话管理', () => {
  beforeEach(() => vi.clearAllMocks())

  it('按更新时间倒序列出会话并附最近一条消息，默认第一页 20 条', async () => {
    mocks.conversationFindMany.mockResolvedValue([{ id: 'c1', messages: [] }])
    const result = await listConversations('user-1')
    expect(mocks.conversationFindMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 20,
      include: { messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } },
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
      include: { messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: 0, take: 50 } },
    })
    expect(detail.id).toBe('c1')

    await getConversation('c1', 'user-1', { page: 2, limit: 30 })
    expect(mocks.conversationFindFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      include: { messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: 30, take: 30 } },
    }))

    // limit 超过 100 封顶
    await getConversation('c1', 'user-1', { limit: 5000 })
    expect(mocks.conversationFindFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      include: { messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: 0, take: 100 } },
    }))

    mocks.conversationFindFirst.mockResolvedValue(null)
    await expect(getConversation('c1', 'other-user')).rejects.toMatchObject({
      statusCode: 404,
      message: '会话不存在',
    })
  })
  it('会话详情默认返回最新 50 条并按时间升序，page=2 返回更早的 10 条', async () => {
    const messages = Array.from({ length: 60 }, (_, index) => ({
      id: `m${String(index + 1).padStart(2, '0')}`,
      createdAt: new Date(Date.UTC(2026, 7, 1, 0, 0, index)),
    }))
    // 模拟数据库：按 createdAt desc + id desc 排序后 skip/take 分页
    mocks.conversationFindFirst.mockImplementation(({ include }) => {
      const { skip, take } = include.messages
      const sorted = [...messages].sort(
        (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
      )
      return Promise.resolve({
        id: 'c1', userId: 'user-1', messages: sorted.slice(skip, skip + take),
      })
    })

    const firstPage = await getConversation('c1', 'user-1')
    expect(firstPage.messages).toHaveLength(50)
    expect(firstPage.messages[0].id).toBe('m11')
    expect(firstPage.messages.at(-1).id).toBe('m60')
    for (let i = 1; i < firstPage.messages.length; i += 1) {
      expect(firstPage.messages[i].createdAt >= firstPage.messages[i - 1].createdAt).toBe(true)
    }

    const secondPage = await getConversation('c1', 'user-1', { page: 2 })
    expect(secondPage.messages.map((message) => message.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `m${String(i + 1).padStart(2, '0')}`),
    )
  })

  it('同毫秒消息按 id 次序确定，恢复升序后 user 在 assistant 前', async () => {
    const sameTime = new Date('2026-08-01T00:00:00.000Z')
    const userMessage = { id: 'msg-aaa', role: 'user', createdAt: sameTime }
    const aiMessage = { id: 'msg-bbb', role: 'assistant', createdAt: sameTime }
    mocks.conversationFindFirst.mockImplementation(({ include }) => {
      expect(include.messages.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }])
      // 数据库按 createdAt desc + id desc 返回：assistant(id 大) 在前
      const sorted = [userMessage, aiMessage].sort((a, b) => b.id.localeCompare(a.id))
      return Promise.resolve({ id: 'c1', userId: 'user-1', messages: sorted })
    })

    const detail = await getConversation('c1', 'user-1')
    expect(detail.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
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
      '你好', 'toxic', [], [], undefined,
      { allowExternal: false, extraSystem: [{ role: 'system', content: expect.stringContaining('add_todo') }], scene: 'chat' },
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
      '你好', 'gentle', [], [], undefined,
      { allowExternal: false, extraSystem: [{ role: 'system', content: expect.stringContaining('add_todo') }], scene: 'chat' },
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
      extraSystem: [{ role: 'system', content: expect.stringContaining('add_todo') }],
      scene: 'chat',
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

  it('work 会话：网关收 scene=work，系统提示为工作前言加 WORK_TOOLS 目录且不含人格提示词', async () => {
    mocks.conversationFindFirst.mockResolvedValue({ id: 'conversation-1', userId: 'user-1', mode: 'work' })

    const result = await sendMessage('conversation-1', 'user-1', '帮我算个账')

    expect(result).toMatchObject({ status: 'ok' })
    const options = mocks.generateResponse.mock.calls[0][5]
    expect(options.scene).toBe('work')
    const systemPrompt = options.extraSystem[0].content
    expect(systemPrompt).toContain('当前是工作模式')
    // WORK_TOOLS 目录进 prompt：日程四件 + 计算 + 搜索（浏览器/生图/终端已随切割删除）
    for (const name of ['add_todo', 'calc_convert', 'web_search']) {
      expect(systemPrompt).toContain(`"tool":"${name}"`)
    }
    for (const name of ['browser_open', 'generate_image', 'bash_run', 'use_skill']) {
      expect(systemPrompt).not.toContain(`"tool":"${name}"`)
    }
    // 聊天专属工具与人格提示词不进入工作模式系统提示
    expect(systemPrompt).not.toContain('add_diary')
    expect(systemPrompt).not.toContain('人设：')
  })

  it('用户带角色时角色设定在工具目录之前注入', async () => {
    mocks.userFindUnique.mockResolvedValue({
      persona: 'toxic',
      externalLlmConsent: true,
      externalLlmConsentVersion: EXTERNAL_LLM_CONSENT_VERSION,
      roleName: '同桌的你',
      roleSetting: '坐我旁边的女生，爱吐槽但总会帮我讲题。',
    })

    const result = await sendMessage('conversation-1', 'user-1', '你好')

    expect(result).toMatchObject({ status: 'ok' })
    const options = mocks.generateResponse.mock.calls[0][5]
    expect(options.extraSystem[0].content).toContain('角色扮演设定')
    expect(options.extraSystem[0].content).toContain('同桌的你')
    expect(options.extraSystem[1].content).toContain('add_todo')
  })

  it('用户无角色时不注入角色设定，extraSystem 首条即工具目录', async () => {
    const result = await sendMessage('conversation-1', 'user-1', '你好')

    expect(result).toMatchObject({ status: 'ok' })
    const options = mocks.generateResponse.mock.calls[0][5]
    expect(options.extraSystem[0].content).toContain('add_todo')
    expect(options.extraSystem.some((m) => m.content.includes('角色扮演设定'))).toBe(false)
  })

  it('work 会话即便有角色也不注入角色设定', async () => {
    mocks.conversationFindFirst.mockResolvedValue({ id: 'conversation-1', userId: 'user-1', mode: 'work' })
    mocks.userFindUnique.mockResolvedValue({
      persona: 'toxic',
      externalLlmConsent: true,
      externalLlmConsentVersion: EXTERNAL_LLM_CONSENT_VERSION,
      roleName: '同桌的你',
      roleSetting: '坐我旁边的女生，爱吐槽但总会帮我讲题。',
    })

    const result = await sendMessage('conversation-1', 'user-1', '帮我算个账')

    expect(result).toMatchObject({ status: 'ok' })
    const options = mocks.generateResponse.mock.calls[0][5]
    expect(options.extraSystem.some((m) => m.content.includes('角色扮演设定'))).toBe(false)
    expect(options.extraSystem[0].content).toContain('当前是工作模式')
  })

  it('每条消息先做隐藏策略斟酌，策略要点作为 system 消息注入工具提示之前', async () => {
    mocks.generateCompanionNote.mockResolvedValue({
      content: '先共情再给建议',
      source: 'local_model',
      provider: 'p',
      model: 'm',
    })

    const result = await sendMessage('conversation-1', 'user-1', '你好')

    expect(result).toMatchObject({ status: 'ok' })
    expect(mocks.generateCompanionNote).toHaveBeenCalledOnce()
    const [noteArgs] = mocks.generateCompanionNote.mock.calls[0]
    expect(noteArgs).toMatchObject({
      persona: 'toxic',
      maxTokens: 200,
      temperature: 0.3,
      timeoutMs: 12000,
    })
    expect(noteArgs.instruction).toContain('内部策略参谋')
    expect(noteArgs.userText).toContain('对话模式=聊天')
    expect(noteArgs.userText).toContain('用户消息：你好')
    const options = mocks.generateResponse.mock.calls[0][5]
    const strategyIndex = options.extraSystem.findIndex((m) => m.content.includes('内部策略要点'))
    const toolIndex = options.extraSystem.findIndex((m) => m.content.includes('add_todo'))
    expect(strategyIndex).toBeGreaterThanOrEqual(0)
    expect(options.extraSystem[strategyIndex].content).toContain('先共情再给建议')
    expect(strategyIndex).toBeLessThan(toolIndex)
  })

  it('策略斟酌失败时静默降级，回复与无斟酌时一致', async () => {
    mocks.generateCompanionNote.mockRejectedValue(new Error('LOCAL_LLM_UNAVAILABLE'))

    const result = await sendMessage('conversation-1', 'user-1', '你好')

    expect(result).toMatchObject({ status: 'ok', source: 'local_model' })
    const options = mocks.generateResponse.mock.calls[0][5]
    expect(options.extraSystem).toEqual([{ role: 'system', content: expect.stringContaining('add_todo') }])
  })

  it('危机阻断先于策略斟酌，斟酌调用不发生', async () => {
    mocks.detectCrisis.mockReturnValue('high')

    const result = await sendMessage('conversation-1', 'user-1', '我不想活了')

    expect(result).toMatchObject({ status: 'blocked' })
    expect(mocks.generateCompanionNote).not.toHaveBeenCalled()
  })

  it('策略斟酌的环境信息按当前小时映射时段', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 7, 23, 0, 0))
    try {
      mocks.generateCompanionNote.mockResolvedValue({
        content: '轻声收尾',
        source: 'local_model',
        provider: 'p',
        model: 'm',
      })

      await sendMessage('conversation-1', 'user-1', '睡不着')

      const [noteArgs] = mocks.generateCompanionNote.mock.calls[0]
      expect(noteArgs.userText).toContain('当前时段=晚上')
    } finally {
      vi.useRealTimers()
    }
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

describe('chatService.sendMessageStream', () => {
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
    mocks.generateCompanionNote.mockRejectedValue(new Error('斟酌不可用'))
    mocks.messageFindMany.mockResolvedValue([])
    mocks.memoryFindMany.mockResolvedValue([])
    mocks.messageCreate.mockImplementation(({ data }) => Promise.resolve({
      id: data.role === 'user' ? 'user-message' : 'ai-message',
      ...data,
    }))
    mocks.conversationUpdate.mockResolvedValue({})
    mocks.crisisCreate.mockResolvedValue({ id: 'crisis-1' })
    mocks.generateResponseStream.mockReturnValue(streamOf([
      { type: 'sentence', text: '第一句。' },
      { type: 'sentence', text: '第二句！' },
      {
        type: 'done',
        content: '第一句。第二句！',
        emotion: 'neutral',
        source: 'local_model',
        provider: 'llamacpp',
        model: 'configured-model',
      },
    ]))
  })

  it('危机输入复用阻断事务落库并产出 blocked，不触达模型与同意检查', async () => {
    mocks.detectCrisis.mockReturnValue('high')

    const events = await collectEvents(sendMessageStream('conversation-1', 'user-1', '我不想活了'))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'blocked',
      status: 'blocked',
      userMessage: { id: 'user-message', role: 'user', content: '我不想活了' },
      intervention: { level: 'high', message: '固定安全干预' },
    })
    expect(mocks.userFindUnique).not.toHaveBeenCalled()
    expect(mocks.generateResponseStream).not.toHaveBeenCalled()
    expect(mocks.transaction).toHaveBeenCalledOnce()
    expect(mocks.messageCreate).toHaveBeenCalledTimes(2)
    expect(mocks.crisisCreate).toHaveBeenCalledOnce()
  })

  it('完整成功后才在一个事务中落库一组消息，done 携带与 JSON 端点一致的字段', async () => {
    const controller = new AbortController()

    const events = await collectEvents(sendMessageStream(
      'conversation-1', 'user-1', '你好', 'req-stream', { signal: controller.signal },
    ))

    expect(events.map((event) => event.type)).toEqual(['sentence', 'sentence', 'done'])
    expect(events[2]).toMatchObject({
      status: 'ok',
      userMessage: { id: 'user-message', role: 'user', content: '你好' },
      aiMessage: {
        id: 'ai-message',
        role: 'assistant',
        content: '第一句。第二句！',
        emotion: 'neutral',
        source: 'local_model',
      },
      source: 'local_model',
    })
    // 只在 done 之后落库：事务恰好一次，先写用户消息再写 AI 消息
    expect(mocks.transaction).toHaveBeenCalledOnce()
    expect(mocks.messageCreate).toHaveBeenCalledTimes(2)
    expect(mocks.messageCreate.mock.calls[0][0].data)
      .toMatchObject({ conversationId: 'conversation-1', role: 'user', content: '你好' })
    expect(mocks.messageCreate.mock.calls[1][0].data)
      .toMatchObject({ role: 'assistant', content: '第一句。第二句！', source: 'local_model' })
    expect(mocks.generateResponseStream).toHaveBeenCalledWith(
      '你好', 'toxic', [], [], 'req-stream',
      { allowExternal: true, authorizeExternal: expect.any(Function), signal: controller.signal, extraSystem: [{ role: 'system', content: expect.stringContaining('add_todo') }], scene: 'chat' },
    )
  })

  it('流中途 error 透传且 prisma 零写入', async () => {
    mocks.generateResponseStream.mockReturnValue(streamOf([
      { type: 'sentence', text: '这句已发出。' },
      { type: 'error', reason: 'STREAM_FAILED' },
    ]))

    const events = await collectEvents(sendMessageStream('conversation-1', 'user-1', '你好'))

    expect(events).toEqual([
      { type: 'sentence', text: '这句已发出。' },
      { type: 'error', reason: 'STREAM_FAILED' },
    ])
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.messageCreate).not.toHaveBeenCalled()
  })

  it('流安静结束（取消）时不落库也不产出收尾事件', async () => {
    mocks.generateResponseStream.mockReturnValue(streamOf([
      { type: 'sentence', text: '只发了一半。' },
    ]))

    const events = await collectEvents(sendMessageStream('conversation-1', 'user-1', '你好'))

    expect(events).toEqual([{ type: 'sentence', text: '只发了一半。' }])
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.messageCreate).not.toHaveBeenCalled()
    expect(mocks.conversationUpdate).not.toHaveBeenCalled()
  })

  it('未同意外部模型时装配与 JSON 路径一致（allowExternal false）', async () => {
    mocks.userFindUnique.mockResolvedValue({
      persona: 'gentle',
      externalLlmConsent: null,
      externalLlmConsentVersion: null,
    })

    const events = await collectEvents(sendMessageStream('conversation-1', 'user-1', '你好'))

    expect(events.at(-1)).toMatchObject({ type: 'done', status: 'ok' })
    expect(mocks.generateResponseStream).toHaveBeenCalledWith(
      '你好', 'gentle', [], [], undefined,
      { allowExternal: false, signal: undefined, extraSystem: [{ role: 'system', content: expect.stringContaining('add_todo') }], scene: 'chat' },
    )
    expect(mocks.transaction).toHaveBeenCalledOnce()
  })

  it('流式路径：策略要点注入系统消息，产出事件序列与内容不含策略文本', async () => {
    mocks.generateCompanionNote.mockResolvedValue({
      content: '先共情再给建议',
      source: 'local_model',
      provider: 'p',
      model: 'm',
    })

    const events = await collectEvents(sendMessageStream('conversation-1', 'user-1', '你好'))

    expect(events.map((event) => event.type)).toEqual(['sentence', 'sentence', 'done'])
    const options = mocks.generateResponseStream.mock.calls[0][5]
    const strategy = options.extraSystem.find((m) => m.content.includes('内部策略要点'))
    expect(strategy?.content).toContain('先共情再给建议')
    const done = events.at(-1)
    expect(done.aiMessage.content).not.toContain('先共情再给建议')
    expect(done.aiMessage.content).not.toContain('内部策略要点')
  })
})

describe('chatService 智能体工具回路', () => {
  const TOOLCALL_TEXT = '{"tool":"add_todo","args":{"content":"周六复诊"}}'

  const streamOf = (events) => (async function* () { for (const event of events) yield event }())

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.conversationFindFirst.mockResolvedValue({ id: 'conversation-1', userId: 'user-1' })
    mocks.userFindUnique.mockResolvedValue({ persona: 'toxic', externalLlmConsent: null, externalLlmConsentVersion: null })
    mocks.messageFindMany.mockResolvedValue([])
    mocks.memoryFindMany.mockResolvedValue([])
    mocks.detectCrisis.mockReturnValue(null)
    mocks.messageCreate.mockImplementation(({ data }) => Promise.resolve({
      id: data.role === 'user' ? 'user-message' : 'ai-message',
      ...data,
    }))
    mocks.executeToolCall.mockResolvedValue({
      tool: 'add_todo',
      ok: true,
      summary: '已添加待办「周六复诊」',
      feedback: '工具执行结果：{"tool":"add_todo","ok":true,"result":{"id":"t1"}}',
    })
    mocks.generateLocalTemplateResponse.mockReturnValue({ content: '兜底回复', emotion: 'neutral', source: 'local_template' })
  })

  it('JSON 路径：执行一次工具调用后正常回复，动作摘要写入 AI 消息', async () => {
    mocks.generateResponse
      .mockResolvedValueOnce({ content: TOOLCALL_TEXT, emotion: 'neutral', source: 'local_model', provider: 'llamacpp', model: 'local-model' })
      .mockResolvedValueOnce({ content: '已经帮你记好啦，还有别的吗', emotion: 'neutral', source: 'local_model', provider: 'llamacpp', model: 'local-model' })

    const result = await sendMessage('conversation-1', 'user-1', '帮我记个待办')

    expect(result.status).toBe('ok')
    expect(mocks.executeToolCall).toHaveBeenCalledOnce()
    expect(mocks.executeToolCall).toHaveBeenCalledWith('user-1', { name: 'add_todo', args: { content: '周六复诊' } }, expect.any(Set), 'chat')
    expect(mocks.generateResponse).toHaveBeenCalledTimes(2)
    const [secondText, , secondHistory, , , secondOptions] = mocks.generateResponse.mock.calls[1]
    expect(secondText).toBe('帮我记个待办')
    expect(secondHistory).toEqual([{ role: 'assistant', content: TOOLCALL_TEXT }])
    expect(secondOptions.extraSystem.at(-1)).toEqual({
      role: 'system',
      content: '工具执行结果：{"tool":"add_todo","ok":true,"result":{"id":"t1"}}',
    })
    expect(mocks.messageCreate.mock.calls[1][0].data.toolRuns).toEqual([
      { tool: 'add_todo', ok: true, summary: '已添加待办「周六复诊」' },
    ])
  })

  it('JSON 路径：三次工具后强制文本轮仍输出工具 JSON 时以本地模板兜底', async () => {
    mocks.generateResponse.mockResolvedValue({ content: TOOLCALL_TEXT, emotion: 'neutral', source: 'local_model' })

    const result = await sendMessage('conversation-1', 'user-1', '帮我记个待办')

    expect(result.status).toBe('ok')
    expect(mocks.executeToolCall).toHaveBeenCalledTimes(3)
    expect(mocks.generateResponse).toHaveBeenCalledTimes(4)
    const aiData = mocks.messageCreate.mock.calls[1][0].data
    expect(aiData.content).toBe('兜底回复')
    expect(aiData.source).toBe('local_template')
    expect(aiData.toolRuns).toHaveLength(3)
  })

  it('流式路径：toolcall 执行后续轮，done 落库并携带 toolRuns', async () => {
    mocks.generateResponseStream
      .mockReturnValueOnce(streamOf([{ type: 'toolcall', name: 'add_todo', args: { content: '周六复诊' } }]))
      .mockReturnValueOnce(streamOf([
        { type: 'sentence', text: '记好啦。' },
        { type: 'done', content: '记好啦。', emotion: 'neutral', source: 'local_model', provider: 'llamacpp', model: 'local-model' },
      ]))

    const events = []
    for await (const event of sendMessageStream('conversation-1', 'user-1', '帮我记个待办', 'req-loop')) events.push(event)

    expect(events.map((event) => event.type)).toEqual(['sentence', 'done'])
    expect(events[1].aiMessage.toolRuns).toEqual([{ tool: 'add_todo', ok: true, summary: '已添加待办「周六复诊」' }])
    expect(mocks.executeToolCall).toHaveBeenCalledOnce()
    const [, , secondHistory, , , secondOptions] = mocks.generateResponseStream.mock.calls[1]
    expect(secondHistory).toEqual([{ role: 'assistant', content: TOOLCALL_TEXT }])
    expect(secondOptions.extraSystem.at(-1).content).toContain('工具执行结果')
  })

  it('流式路径：强制文本轮仍输出工具 JSON 时替换为本地模板后落库', async () => {
    const toolcallStream = () => streamOf([{ type: 'toolcall', name: 'add_todo', args: { content: '周六复诊' } }])
    mocks.generateResponseStream
      .mockReturnValueOnce(toolcallStream())
      .mockReturnValueOnce(toolcallStream())
      .mockReturnValueOnce(toolcallStream())
      .mockReturnValueOnce(streamOf([
        { type: 'sentence', text: '先说半句。' },
        { type: 'done', content: TOOLCALL_TEXT, emotion: 'neutral', source: 'local_model', provider: 'llamacpp', model: 'local-model' },
      ]))

    const events = []
    for await (const event of sendMessageStream('conversation-1', 'user-1', '帮我记个待办', 'req-loop-2')) events.push(event)

    expect(mocks.executeToolCall).toHaveBeenCalledTimes(3)
    expect(events.map((event) => event.type)).toEqual(['sentence', 'replace', 'done'])
    expect(events[1]).toEqual({ type: 'replace', content: '兜底回复', source: 'local_template' })
    expect(events[2].aiMessage.content).toBe('兜底回复')
    expect(events[2].aiMessage.toolRuns).toHaveLength(3)
  })
})
