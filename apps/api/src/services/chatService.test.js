import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  companionFindUnique: vi.fn(() => Promise.resolve({ companionState: null, companionRevision: 0 })),
  companionUpdate: vi.fn(() => Promise.resolve({})),
  companionLock: vi.fn(() => Promise.resolve([{ id: 'user-1' }])),
  conversationFindFirst: vi.fn(),
  conversationFindUnique: vi.fn(),
  conversationFindMany: vi.fn(),
  conversationCreate: vi.fn(),
  conversationDelete: vi.fn(),
  conversationUpdate: vi.fn(),
  conversationUpdateMany: vi.fn(),
  messageFindMany: vi.fn(),
  messageCount: vi.fn(() => Promise.resolve(0)),
  messageDeleteMany: vi.fn(),
  messageUpdate: vi.fn(),
  messageCreate: vi.fn(),
  bookFindFirst: vi.fn(),
  diaryFindMany: vi.fn(() => Promise.resolve([])),
  periodFindFirst: vi.fn(() => Promise.resolve(null)),
  describeRecentNudges: vi.fn(() => Promise.resolve([])),
  memoryFindMany: vi.fn(),
  memoryEdgeFindMany: vi.fn(),
  derivedInsightFindMany: vi.fn(),
  crisisCreate: vi.fn(),
  transaction: vi.fn(),
  generateResponse: vi.fn(),
  generateResponseStream: vi.fn(),
  generateLocalTemplateResponse: vi.fn(),
  generateCompanionNote: vi.fn(),
  retrieveRelevantMemories: vi.fn((_text, memories) => memories),
  executeToolCall: vi.fn(),
  detectCrisis: vi.fn(),
  saveChatImage: vi.fn(),
  deleteChatImages: vi.fn(),
  embedQuery: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('../prisma/client.js', () => {
  const tx = {
    user: { findUnique: mocks.companionFindUnique, update: mocks.companionUpdate },
      $queryRaw: mocks.companionLock,
      message: { create: mocks.messageCreate },
    conversation: { update: mocks.conversationUpdate },
    crisisLog: { create: mocks.crisisCreate },
  }
  return {
    default: {
      user: { findUnique: mocks.userFindUnique },
      conversation: {
        findFirst: mocks.conversationFindFirst,
        findUnique: mocks.conversationFindUnique,
        findMany: mocks.conversationFindMany,
        create: mocks.conversationCreate,
        update: mocks.conversationUpdate,
        updateMany: mocks.conversationUpdateMany,
        delete: mocks.conversationDelete,
      },
      message: { findMany: mocks.messageFindMany, count: mocks.messageCount, deleteMany: mocks.messageDeleteMany, update: mocks.messageUpdate },
      book: { findFirst: mocks.bookFindFirst },
      diaryEntry: { findMany: mocks.diaryFindMany },
      periodRecord: { findFirst: mocks.periodFindFirst },
      crisisLog: { create: mocks.crisisCreate },
      memory: { findMany: mocks.memoryFindMany },
      memoryEdge: { findMany: mocks.memoryEdgeFindMany },
      derivedInsight: { findMany: mocks.derivedInsightFindMany },
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

// 「她今天说过的话」由 nudgeService 自己的单测覆盖，这里只看它怎么进上下文
vi.mock('./nudgeService.js', () => ({
  describeRecentNudges: mocks.describeRecentNudges,
}))

vi.mock('./embeddingService.js', () => ({
  embedQuery: mocks.embedQuery,
}))

vi.mock('./agentService.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, executeToolCall: mocks.executeToolCall, executeToolCallOnce: mocks.executeToolCall }
})

vi.mock('./chatImageService.js', () => ({
  saveChatImage: mocks.saveChatImage,
  deleteChatImages: mocks.deleteChatImages,
}))

vi.mock('./detection.js', async (importOriginal) => ({
  ...(await importOriginal()),
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
  clearThread,
  executeScheduledTask,
  deleteConversation,
  getConversation,
  getThread,
  listConversations,
  setConversationArchived,
  sendMessage,
  sendMessageStream,
} from './chatService.js'
import { EXTERNAL_LLM_CONSENT_VERSION } from './userService.js'
import { detectRememberIntent } from './contextBlocks.js'
import { initExtensions, shutdownExtensions } from './extensionRuntime.js'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('chatService 会话管理', () => {
  beforeEach(() => vi.clearAllMocks())

  it('按更新时间倒序列出会话并附最近一条消息，默认第一页 20 条', async () => {
    mocks.conversationFindMany.mockResolvedValue([{ id: 'c1', messages: [] }])
    const result = await listConversations('user-1')
    expect(mocks.conversationFindMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', archivedAt: null },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 20,
      include: { messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } },
    })
    expect(result).toHaveLength(1)
  })

  it('归档查询只返回当前用户的归档对话', async () => {
    mocks.conversationFindMany.mockResolvedValue([])
    await listConversations('user-1', { archived: true })
    expect(mocks.conversationFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1', archivedAt: { not: null } },
    }))
  })

  it('归档与恢复原子校验归属，保留消息', async () => {
    mocks.conversationUpdateMany.mockResolvedValue({ count: 1 })
    await expect(setConversationArchived('c1', 'user-1', true)).resolves.toEqual({ success: true, archived: true })
    expect(mocks.conversationUpdateMany).toHaveBeenCalledWith({ where: { id: 'c1', userId: 'user-1' }, data: { archivedAt: expect.any(Date) } })
    await setConversationArchived('c1', 'user-1', false)
    expect(mocks.conversationUpdateMany).toHaveBeenLastCalledWith({ where: { id: 'c1', userId: 'user-1' }, data: { archivedAt: null } })
    expect(mocks.conversationDelete).not.toHaveBeenCalled()
    expect(mocks.messageCreate).not.toHaveBeenCalled()
    mocks.conversationUpdateMany.mockResolvedValue({ count: 0 })
    await expect(setConversationArchived('c1', 'other-user', true)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('拒绝非法归档值，以及向归档会话发送普通或流式消息', async () => {
    await expect(setConversationArchived('c1', 'user-1', 'true')).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.conversationUpdateMany).not.toHaveBeenCalled()
    mocks.conversationFindFirst.mockResolvedValue({ id: 'c1', archivedAt: new Date() })
    await expect(sendMessage('c1', 'user-1', '继续聊')).rejects.toMatchObject({ code: 'CONVERSATION_ARCHIVED' })
    await expect(sendMessageStream('c1', 'user-1', '继续聊').next()).rejects.toMatchObject({ code: 'CONVERSATION_ARCHIVED' })
    expect(mocks.generateResponse).not.toHaveBeenCalled()
    expect(mocks.generateResponseStream).not.toHaveBeenCalled()
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

  it('会话详情按归属查询并分页消息，不存在抛 404', async () => {
    mocks.conversationFindFirst.mockResolvedValue({ id: 'c1', userId: 'user-1', messages: [] })
    const detail = await getConversation('c1', 'user-1')
    expect(mocks.conversationFindFirst).toHaveBeenCalledWith({
      where: { id: 'c1', userId: 'user-1' },
      include: { messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: 0, take: 50, include: { workArtifacts: { select: { id: true, title: true, format: true, origin: true, sizeBytes: true, createdAt: true } } } } },
    })
    expect(detail.id).toBe('c1')

    await getConversation('c1', 'user-1', { page: 2, limit: 30 })
    expect(mocks.conversationFindFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      include: { messages: expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: 30, take: 30 }) },
    }))

    // limit 超过 100 封顶
    await getConversation('c1', 'user-1', { limit: 5000 })
    expect(mocks.conversationFindFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      include: { messages: expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: 0, take: 100 }) },
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
    mocks.messageFindMany.mockResolvedValue([])
    mocks.deleteChatImages.mockResolvedValue(undefined)
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
      user: { findUnique: mocks.companionFindUnique, update: mocks.companionUpdate },
      $queryRaw: mocks.companionLock,
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
    mocks.memoryEdgeFindMany.mockResolvedValue([])
    mocks.embedQuery.mockResolvedValue(null)
    mocks.derivedInsightFindMany.mockResolvedValue([])
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
      { allowExternal: false, queryEmbedding: null, memoryEdges: [], memoriesSelected: true, promptInHistory: false, extraSystem: [{ role: 'system', content: expect.stringContaining('【此刻】') }, { role: 'system', content: expect.stringContaining('【这一轮的分寸】') }, { role: 'system', content: expect.stringContaining('add_task') }], scene: 'chat', agent: true },
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
      { allowExternal: false, queryEmbedding: null, memoryEdges: [], memoriesSelected: true, promptInHistory: false, extraSystem: [{ role: 'system', content: expect.stringContaining('【此刻】') }, { role: 'system', content: expect.stringContaining('【这一轮的分寸】') }, { role: 'system', content: expect.stringContaining('add_task') }], scene: 'chat', agent: true },
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
      memoriesSelected: true, promptInHistory: false, extraSystem: [{ role: 'system', content: expect.stringContaining('【此刻】') }, { role: 'system', content: expect.stringContaining('【这一轮的分寸】') }, { role: 'system', content: expect.stringContaining('add_task') }],
      scene: 'chat',
      agent: true,
      queryEmbedding: null,
      memoryEdges: [],
    })
    expect(mocks.messageCreate).toHaveBeenCalledTimes(2)
  })
  it('检索覆盖所有有效正式记忆，不先截断 200 条', async () => {
    await sendMessage('conversation-1', 'user-1', '你好')

    expect(mocks.memoryFindMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
      where: { userId: 'user-1', OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] },
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

  it('/skill:name 展开成技能正文块作为用户消息，落库仍是原文', async () => {
    const raw = '/skill:memory 她们都记得哪些？'
    await expect(sendMessage('conversation-1', 'user-1', raw)).resolves.toMatchObject({ status: 'ok' })
    const [current, , , , , options] = mocks.generateResponse.mock.calls[0]
    expect(current).toBe(raw)
    expect(options.userText.startsWith('<skill name="memory">')).toBe(true)
    expect(options.userText).toContain('她记得的你')
    expect(options.userText).toContain('</skill>\n\n她们都记得哪些？')
    expect(options.userText).not.toContain('description:')
    expect(mocks.messageCreate).toHaveBeenCalledWith({ data: { conversationId: 'conversation-1', role: 'user', content: raw } })
  })

  it('/skill: 后 context 与记忆意图判定仍基于原文', async () => {
    const result = await sendMessage('conversation-1', 'user-1', '/skill:memory')
    const [current, , , , , options] = mocks.generateResponse.mock.calls[0]
    expect(current).toBe('/skill:memory')
    // 展开块里有「帮我记住」字样：判定若误跑在展开文本上就会弹出记忆确认卡
    expect(detectRememberIntent(options.userText)).toBe(true)
    expect(result.offerMemory).toBe(false)
  })

  it('input 钩子只改发给模型的文本，落库与判定仍用原文', async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'amie-ext-'))
    try {
      writeFileSync(path.join(tempRoot, 'in.js'), `export default (pi) => {
        pi.on('input', (event) => ({ action: 'transform', text: event.text + '（补）' }))
      }`)
      await initExtensions({ dirs: [tempRoot] })
      await sendMessage('conversation-1', 'user-1', '你好')
      const [current, , , , , options] = mocks.generateResponse.mock.calls[0]
      expect(current).toBe('你好')
      expect(options.userText).toBe('你好（补）')
      expect(mocks.messageCreate).toHaveBeenCalledWith({ data: { conversationId: 'conversation-1', role: 'user', content: '你好' } })
    } finally {
      await shutdownExtensions()
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('没有这个技能报 400，不触达模型也不落库', async () => {
    await expect(sendMessage('conversation-1', 'user-1', '/skill:nope 干点啥')).rejects.toMatchObject({
      statusCode: 400,
      message: '没有「nope」这个技能',
    })
    expect(mocks.generateResponse).not.toHaveBeenCalled()
    expect(mocks.messageCreate).not.toHaveBeenCalled()
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

  it('遗留的 work 会话在本地按同一种对话处理：模型场景 chat，保留同意检查与完成后落库', async () => {
    mocks.conversationFindFirst.mockResolvedValue({ id: 'conversation-1', userId: 'user-1', mode: 'work' })
    await expect(sendMessage('conversation-1', 'user-1', '帮我算个账')).resolves.toMatchObject({ status: 'ok' })
    expect(mocks.generateResponse.mock.calls[0][5]).toMatchObject({ scene: 'chat', agent: true, allowExternal: true })
    expect(mocks.generateCompanionNote).not.toHaveBeenCalled()
    expect(mocks.executeToolCall).not.toHaveBeenCalled()
    expect(mocks.transaction).toHaveBeenCalledOnce()
  })

  it('角色扮演已取消：旧数据里的角色值不再注入系统提示', async () => {
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
    expect(options.extraSystem.some((m) => m.content.includes('角色扮演设定') || m.content.includes('同桌的你'))).toBe(false)
    expect(options.extraSystem.at(-1).content).toContain('add_task')
  })

  it('用户无角色时仍注入运行状态，工具目录保持存在', async () => {
    const result = await sendMessage('conversation-1', 'user-1', '你好')

    expect(result).toMatchObject({ status: 'ok' })
    const options = mocks.generateResponse.mock.calls[0][5]
    expect(options.extraSystem.at(-1).content).toContain('add_task')
    expect(options.extraSystem.some((m) => m.content.includes('角色扮演设定'))).toBe(false)
  })

  it('work 会话仍优先处理危机，不进入模型或工作门', async () => {
    mocks.conversationFindFirst.mockResolvedValue({ id: 'conversation-1', userId: 'user-1', mode: 'work' })
    mocks.detectCrisis.mockReturnValue('critical')
    const result = await sendMessage('conversation-1', 'user-1', '需要帮助')
    expect(result.status).toBe('blocked')
    expect(mocks.generateResponse).not.toHaveBeenCalled()
    expect(mocks.embedQuery).not.toHaveBeenCalled()
  })

  it('任何对话都用同一份工具目录：陪伴与办事工具都在，并附做事规则', async () => {
    mocks.userFindUnique.mockResolvedValue({ persona: 'toxic', externalLlmConsent: true, externalLlmConsentVersion: EXTERNAL_LLM_CONSENT_VERSION })
    await expect(sendMessage('conversation-1', 'user-1', '帮我算个账')).resolves.toMatchObject({ status: 'ok' })
    const options = mocks.generateResponse.mock.calls[0][5]
    expect(options).toMatchObject({ scene: 'chat', agent: true, allowExternal: true })
    const catalog = options.extraSystem.at(-1).content
    for (const name of ['add_task', 'add_diary', 'calc_convert', 'create_artifact']) expect(catalog).toContain(`"tool":"${name}"`)
    expect(catalog).toContain('用户交办任务')
  })

  it('本地状态取代云端策略斟酌，完成后同事务保存成长依据', async () => {
    const result = await sendMessage('conversation-1', 'user-1', '谢谢你')
    expect(result.status).toBe('ok')
    expect(mocks.generateCompanionNote).not.toHaveBeenCalled()
    expect(mocks.generateResponse).toHaveBeenCalledOnce()
    const options = mocks.generateResponse.mock.calls[0][5]
    expect(options.extraSystem.some((item) => item.content.includes('【这一轮的分寸】'))).toBe(true)
    expect(options.extraSystem.at(-1).content).toContain('add_task')
    expect(mocks.companionUpdate).toHaveBeenCalledOnce()
    expect(result.aiMessage.companionExperience).toMatchObject({ revision: 1, observation: { positive: 1 } })
  })

  it('危机阻断先于策略斟酌，斟酌调用不发生', async () => {
    mocks.detectCrisis.mockReturnValue('high')

    const result = await sendMessage('conversation-1', 'user-1', '我不想活了')

    expect(result).toMatchObject({ status: 'blocked' })
    expect(mocks.generateCompanionNote).not.toHaveBeenCalled()
  })

  it('只是倾诉的一轮不塞工具目录；一带办事的线索就照常给', async () => {
    await sendMessage('conversation-1', 'user-1', '今天好难过')
    const feeling = mocks.generateResponse.mock.calls[0][5]
    expect(feeling.extraSystem.some((item) => item.content.includes('add_task'))).toBe(false)
    expect(feeling.extraSystem.at(-1).content).toContain('这一轮是聊天')
    expect(feeling).not.toHaveProperty('tools')

    await sendMessage('conversation-1', 'user-1', '好难过，帮我定个明早 7 点的闹钟')
    expect(mocks.generateResponse.mock.calls[1][5].extraSystem.at(-1).content).toContain('add_task')
  })

  it('持久学习参数改变下一轮表达，角色状态不会成为用户正式记忆', async () => {
    const { createCompanionState } = await import('./companionState.js')
    const state = createCompanionState(Date.now())
    state.learning.brevity = 0.85
    mocks.userFindUnique.mockResolvedValue({ persona: 'toxic', companionState: state, companionRevision: 8 })
    const result = await sendMessage('conversation-1', 'user-1', '你好')
    expect(mocks.generateResponse.mock.calls[0][5].extraSystem.find((item) => item.content.includes('【这一轮的分寸】')).content).toContain('偏简洁')
    expect(result.aiMessage.companionExperience.basedOnRevision).toBe(8)
    expect(mocks.generateCompanionNote).not.toHaveBeenCalled()
  })

  it('存在理解草稿时也不查询或传入模型', async () => {
    const insights = [{ kind: 'pattern', content: '她习惯深夜学习', confidence: 'medium' }]
    mocks.derivedInsightFindMany.mockResolvedValue(insights)

    const result = await sendMessage('conversation-1', 'user-1', '你好')

    expect(result).toMatchObject({ status: 'ok' })
    expect(mocks.derivedInsightFindMany).not.toHaveBeenCalled()
    const options = mocks.generateResponse.mock.calls[0][5]
    expect(options).not.toHaveProperty('derivedInsights')
  })

  it('聊天选项没有未确认草稿入口', async () => {
    const result = await sendMessage('conversation-1', 'user-1', '你好')

    expect(result).toMatchObject({ status: 'ok' })
    const options = mocks.generateResponse.mock.calls[0][5]
    expect(options).not.toHaveProperty('derivedInsights')
  })

  it('记忆查询带出 id/revision/projection；同意时 embedQuery 结果注入 queryEmbedding', async () => {
    mocks.embedQuery.mockResolvedValue([0.1, 0.2, 0.3])
    mocks.memoryFindMany.mockResolvedValue([
      { id: 'm1', content: '喜欢火锅', type: 'semantic', importance: 5, tags: '[]', embedding: [0.9] },
    ])

    await sendMessage('conversation-1', 'user-1', '今晚吃啥')

    expect(mocks.memoryFindMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ id: true, revision: true, projection: true }),
    }))
    expect(mocks.embedQuery).toHaveBeenCalledWith('今晚吃啥', expect.objectContaining({ allowExternal: true, authorizeExternal: expect.any(Function) }))
    expect(mocks.generateResponse.mock.calls[0][5].queryEmbedding).toEqual([0.1, 0.2, 0.3])
  })

  it('canonical 边 join 当前记忆集内容注入 memoryEdges；引用集外记忆的边丢弃', async () => {
    mocks.memoryFindMany.mockResolvedValue([
      { id: 'm1', content: '喜欢火锅', type: 'semantic', importance: 5, tags: '[]', revision: 1, projection: null },
      { id: 'm2', content: '每周五吃火锅', type: 'episodic', importance: 4, tags: '[]', revision: 1, projection: null },
    ])
    mocks.memoryEdgeFindMany.mockResolvedValue([
      { fromMemoryId: 'm1', toMemoryId: 'm2', fromRevision: 1, toRevision: 1, relation: 'related' },
      { fromMemoryId: 'm1', toMemoryId: 'gone' },
    ])

    await sendMessage('conversation-1', 'user-1', '你好')

    expect(mocks.memoryEdgeFindMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', status: 'canonical' },
      select: { fromMemoryId: true, toMemoryId: true, fromRevision: true, toRevision: true, relation: true },
    })
    expect(mocks.generateResponse.mock.calls[0][5].memoryEdges).toEqual([
      { fromMemoryId: 'm1', toMemoryId: 'm2', fromContent: '喜欢火锅', toContent: '每周五吃火锅', relation: 'related' },
    ])
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
      user: { findUnique: mocks.companionFindUnique, update: mocks.companionUpdate },
      $queryRaw: mocks.companionLock,
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
    mocks.memoryEdgeFindMany.mockResolvedValue([])
    mocks.embedQuery.mockResolvedValue(null)
    mocks.derivedInsightFindMany.mockResolvedValue([])
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

  it('流式路径同样展开 /skill:，只影响模型输入', async () => {
    const raw = '/skill:memory'
    const events = await collectEvents(sendMessageStream('conversation-1', 'user-1', raw, 'req-skill'))
    expect(events.at(-1)).toMatchObject({ type: 'done', status: 'ok' })
    expect(mocks.generateResponseStream.mock.calls[0][0]).toBe(raw)
    expect(mocks.generateResponseStream.mock.calls[0][5].userText.startsWith('<skill name="memory">')).toBe(true)
    expect(mocks.messageCreate).toHaveBeenCalledWith({ data: { conversationId: 'conversation-1', role: 'user', content: raw } })
  })

  it('work 流式危机分支先于接口未接入门', async () => {
    mocks.conversationFindFirst.mockResolvedValue({ id: 'conversation-1', userId: 'user-1', mode: 'work' })
    mocks.detectCrisis.mockReturnValue('critical')
    const events = await collectEvents(sendMessageStream('conversation-1', 'user-1', '需要帮助', 'req-work-crisis'))
    expect(events).toEqual([expect.objectContaining({ type: 'blocked', status: 'blocked' })])
    expect(mocks.generateResponseStream).not.toHaveBeenCalled()
    expect(mocks.embedQuery).not.toHaveBeenCalled()
  })

  it('遗留的 work 会话流式发送同样按统一对话处理并事务保存', async () => {
    mocks.conversationFindFirst.mockResolvedValue({ id: 'conversation-1', userId: 'user-1', mode: 'work' })
    const events = await collectEvents(sendMessageStream('conversation-1', 'user-1', '做计划', 'req-work'))
    expect(events.at(-1)).toMatchObject({ type: 'done', status: 'ok' })
    expect(mocks.generateResponseStream.mock.calls[0][5]).toMatchObject({ scene: 'chat', agent: true })
    expect(mocks.generateCompanionNote).not.toHaveBeenCalled()
    expect(mocks.executeToolCall).not.toHaveBeenCalled()
    expect(mocks.transaction).toHaveBeenCalledOnce()
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
      { allowExternal: true, authorizeExternal: expect.any(Function), queryEmbedding: null, memoryEdges: [], signal: controller.signal, memoriesSelected: true, promptInHistory: false, extraSystem: [{ role: 'system', content: expect.stringContaining('【此刻】') }, { role: 'system', content: expect.stringContaining('【这一轮的分寸】') }, { role: 'system', content: expect.stringContaining('add_task') }], scene: 'chat', agent: true },
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

  it('已取消的请求不查询上下文、不调用模型也不落库', async () => {
    const controller = new AbortController()
    controller.abort()
    const events = await collectEvents(sendMessageStream('conversation-1', 'user-1', '你好', 'cancelled', { signal: controller.signal }))
    expect(events).toEqual([])
    expect(mocks.conversationFindFirst).not.toHaveBeenCalled()
    expect(mocks.embedQuery).not.toHaveBeenCalled()
    expect(mocks.generateResponseStream).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('向量查询期间取消后不再斟酌或生成，取消信号贯穿预处理', async () => {
    const controller = new AbortController()
    mocks.embedQuery.mockImplementationOnce(async () => { controller.abort(); return null })
    const events = await collectEvents(sendMessageStream('conversation-1', 'user-1', '你好', 'cancelled', { signal: controller.signal }))
    expect(events).toEqual([])
    expect(mocks.embedQuery.mock.calls[0][1]).toMatchObject({ signal: controller.signal })
    expect(mocks.generateCompanionNote).not.toHaveBeenCalled()
    expect(mocks.generateResponseStream).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it.each(['done', 'toolcall'])('模型在取消后迟到的 %s 不产生消息或工具副作用', async (type) => {
    const controller = new AbortController()
    mocks.generateResponseStream.mockImplementationOnce(async function* () {
      controller.abort()
      yield { type, content: '已完成', name: 'add_task', args: { content: '迟到任务' } }
    })
    const events = await collectEvents(sendMessageStream('conversation-1', 'user-1', '你好', 'cancelled', { signal: controller.signal }))
    expect(events).toEqual([])
    expect(mocks.executeToolCall).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('error 是终态，即使适配器错误地继续 done 也不落库', async () => {
    mocks.generateResponseStream.mockReturnValueOnce(streamOf([
      { type: 'error', reason: 'STREAM_FAILED' },
      { type: 'done', content: '不应保存' },
    ]))
    const events = await collectEvents(sendMessageStream('conversation-1', 'user-1', '你好'))
    expect(events).toEqual([{ type: 'error', reason: 'STREAM_FAILED' }])
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('事务写入期间取消抛错，交由数据库回滚整轮', async () => {
    const controller = new AbortController()
    mocks.messageCreate.mockImplementationOnce(async ({ data }) => {
      controller.abort()
      return { id: 'cancelled-message', ...data }
    })
    await expect(collectEvents(sendMessageStream('conversation-1', 'user-1', '你好', 'cancelled', { signal: controller.signal })))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.messageCreate).toHaveBeenCalledTimes(1)
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
      { allowExternal: false, queryEmbedding: null, memoryEdges: [], signal: undefined, memoriesSelected: true, promptInHistory: false, extraSystem: [{ role: 'system', content: expect.stringContaining('【此刻】') }, { role: 'system', content: expect.stringContaining('【这一轮的分寸】') }, { role: 'system', content: expect.stringContaining('add_task') }], scene: 'chat', agent: true },
    )
    expect(mocks.transaction).toHaveBeenCalledOnce()
  })

  it('流式路径注入本地状态，成功完成时只学习一次，公开句子保持原有语义', async () => {
    const output = await collectEvents(sendMessageStream('conversation-1', 'user-1', '你好'))
    expect(output.map((event) => event.type)).toEqual(['sentence', 'sentence', 'done'])
    const options = mocks.generateResponseStream.mock.calls[0][5]
    expect(options.extraSystem.some((item) => item.content.includes('【这一轮的分寸】'))).toBe(true)
    expect(mocks.generateCompanionNote).not.toHaveBeenCalled()
    expect(mocks.companionUpdate).toHaveBeenCalledOnce()
    expect(output.at(-1).aiMessage.content).not.toContain('【这一轮的分寸】')
  })
})

describe('chatService 智能体工具回路', () => {
  const TOOLCALL_TEXT = '{"tool":"add_task","args":{"content":"周六复诊"}}'

  const streamOf = (events) => (async function* () { for (const event of events) yield event }())

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.conversationFindFirst.mockResolvedValue({ id: 'conversation-1', userId: 'user-1' })
    mocks.userFindUnique.mockResolvedValue({ persona: 'toxic', externalLlmConsent: null, externalLlmConsentVersion: null })
    mocks.messageFindMany.mockResolvedValue([])
    mocks.memoryFindMany.mockResolvedValue([])
    mocks.derivedInsightFindMany.mockResolvedValue([])
    mocks.memoryEdgeFindMany.mockResolvedValue([])
    mocks.embedQuery.mockResolvedValue(null)
    mocks.detectCrisis.mockReturnValue(null)
    mocks.messageCreate.mockImplementation(({ data }) => Promise.resolve({
      id: data.role === 'user' ? 'user-message' : 'ai-message',
      ...data,
    }))
    mocks.executeToolCall.mockResolvedValue({
      tool: 'add_task',
      ok: true,
      summary: '已安排「周六复诊」',
      feedback: '工具执行结果：{"tool":"add_task","ok":true,"result":{"id":"t1"}}',
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
    expect(mocks.executeToolCall).toHaveBeenCalledWith('user-1', { name: 'add_task', args: { content: '周六复诊' } }, expect.any(Map), expect.objectContaining({ conversationId: 'conversation-1' }))
    expect(mocks.generateResponse).toHaveBeenCalledTimes(2)
    const [secondText, , secondHistory, , , secondOptions] = mocks.generateResponse.mock.calls[1]
    expect(secondText).toBe('帮我记个待办')
    expect(secondOptions.promptInHistory).toBe(true)
    expect(secondHistory).toEqual([
      { role: 'user', content: '帮我记个待办' },
      { role: 'assistant', content: TOOLCALL_TEXT },
      // 回喂紧跟助手工具 JSON 且用 user 角色（末尾 system 消息常被推理模型无视；
      // 不走 extraSystem——网关会把 extraSystem 放到会话最前）
      { role: 'user', content: '工具执行结果：{"tool":"add_task","ok":true,"result":{"id":"t1"}}' },
    ])
    expect(mocks.messageCreate.mock.calls[1][0].data.toolRuns).toEqual([
      { tool: 'add_task', ok: true, summary: '已安排「周六复诊」' },
    ])
  })

  it('JSON 路径：工具轮数用尽仍输出工具 JSON 时，如实交代已完成的操作', async () => {
    mocks.generateResponse.mockResolvedValue({ content: TOOLCALL_TEXT, emotion: 'neutral', source: 'local_model' })

    const result = await sendMessage('conversation-1', 'user-1', '帮我记个待办')

    expect(result.status).toBe('ok')
    expect(mocks.executeToolCall).toHaveBeenCalledTimes(12)
    expect(mocks.generateResponse).toHaveBeenCalledTimes(13)
    const aiData = mocks.messageCreate.mock.calls[1][0].data
    expect(aiData.content).toContain('这轮先到这儿')
    expect(aiData.content).toContain('已安排「周六复诊」')
    expect(aiData.source).toBe('local_template')
    expect(aiData.toolRuns).toHaveLength(12)
  })

  it('流式路径：toolcall 执行后续轮，done 落库并携带 toolRuns', async () => {
    mocks.generateResponseStream
      .mockReturnValueOnce(streamOf([{ type: 'toolcall', name: 'add_task', args: { content: '周六复诊' } }]))
      .mockReturnValueOnce(streamOf([
        { type: 'sentence', text: '记好啦。' },
        { type: 'done', content: '记好啦。', emotion: 'neutral', source: 'local_model', provider: 'llamacpp', model: 'local-model' },
      ]))

    const events = []
    for await (const event of sendMessageStream('conversation-1', 'user-1', '帮我记个待办', 'req-loop')) events.push(event)

    expect(events.map((event) => event.type)).toEqual(['tool_progress', 'tool_progress', 'sentence', 'done'])
    expect(events[0]).toMatchObject({ step: 0, status: 'running', tool: 'add_task' })
    expect(events.at(-1).aiMessage.toolRuns).toEqual([{ tool: 'add_task', ok: true, summary: '已安排「周六复诊」' }])
    expect(mocks.executeToolCall).toHaveBeenCalledOnce()
    const [, , secondHistory, , , secondOptions] = mocks.generateResponseStream.mock.calls[1]
    expect(secondOptions.promptInHistory).toBe(true)
    expect(secondHistory).toEqual([
      { role: 'user', content: '帮我记个待办' },
      { role: 'assistant', content: TOOLCALL_TEXT },
      { role: 'user', content: '工具执行结果：{"tool":"add_task","ok":true,"result":{"id":"t1"}}' },
    ])
  })

  it('流式路径：强制文本轮仍输出工具 JSON 时替换为如实的收尾说明后落库', async () => {
    const toolcallStream = () => streamOf([{ type: 'toolcall', name: 'add_task', args: { content: '周六复诊' } }])
    for (let round = 0; round < 12; round += 1) mocks.generateResponseStream.mockReturnValueOnce(toolcallStream())
    mocks.generateResponseStream.mockReturnValueOnce(streamOf([
      { type: 'sentence', text: '先说半句。' },
      { type: 'done', content: TOOLCALL_TEXT, emotion: 'neutral', source: 'local_model', provider: 'llamacpp', model: 'local-model' },
    ]))

    const events = []
    for await (const event of sendMessageStream('conversation-1', 'user-1', '帮我记个待办', 'req-loop-2')) events.push(event)

    expect(mocks.executeToolCall).toHaveBeenCalledTimes(12)
    const visible = events.filter((event) => event.type !== 'tool_progress')
    expect(visible.map((event) => event.type)).toEqual(['sentence', 'replace', 'done'])
    expect(visible[1]).toMatchObject({ type: 'replace', source: 'local_template' })
    expect(visible[1].content).toContain('这轮先到这儿')
    expect(visible[2].aiMessage.content).toBe(visible[1].content)
    expect(visible[2].aiMessage.toolRuns).toHaveLength(12)
  })

  it('流式在上限后仍为 toolcall 事件时与 JSON 路径一致地收尾，不再执行工具', async () => {
    mocks.generateResponseStream.mockImplementation(() => streamOf([
      { type: 'toolcall', name: 'add_task', args: { content: '周六复诊' } },
    ]))
    const events = []
    for await (const event of sendMessageStream('conversation-1', 'user-1', '帮我记个待办')) events.push(event)
    expect(mocks.executeToolCall).toHaveBeenCalledTimes(12)
    expect(mocks.generateResponseStream).toHaveBeenCalledTimes(13)
    expect(events.filter((event) => event.type !== 'tool_progress').map((event) => event.type)).toEqual(['replace', 'done'])
    expect(events.at(-1).aiMessage.content).toContain('这轮先到这儿')
  })
})

describe('chatService 图片消息', () => {
  const IMAGE = { buffer: Buffer.from('fake-jpeg'), mime: 'image/jpeg' }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.transaction.mockImplementation((callback) => callback({
      user: { findUnique: mocks.companionFindUnique, update: mocks.companionUpdate },
      $queryRaw: mocks.companionLock,
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
    mocks.derivedInsightFindMany.mockResolvedValue([])
    mocks.memoryEdgeFindMany.mockResolvedValue([])
    mocks.embedQuery.mockResolvedValue(null)
    mocks.messageCreate.mockImplementation(({ data }) => Promise.resolve({
      id: data.role === 'user' ? 'user-message' : 'ai-message',
      ...data,
    }))
    mocks.conversationUpdate.mockResolvedValue({})
    mocks.messageUpdate.mockResolvedValue({})
    mocks.saveChatImage.mockResolvedValue('.jpg')
    mocks.deleteChatImages.mockResolvedValue(undefined)
    mocks.generateResponseStream.mockReturnValue(streamOf([
      {
        type: 'done',
        content: '这身搭配好看。',
        emotion: 'happy',
        source: 'qwen',
        provider: 'qwen',
        model: 'vision-model',
      },
    ]))
  })

  it('流式带 image：每轮 generateResponseStream options 透传 image，extraSystem 含照片点评引导', async () => {
    await collectEvents(sendMessageStream('conversation-1', 'user-1', '看这身', 'req-img', { image: IMAGE }))

    const options = mocks.generateResponseStream.mock.calls[0][5]
    expect(options.image).toBe(IMAGE)
    expect(options.extraSystem.some((m) => m.content.includes('用户这轮发来一张照片'))).toBe(true)
  })

  it('工具回路第二轮同样带图', async () => {
    mocks.generateResponseStream
      .mockReturnValueOnce(streamOf([{ type: 'toolcall', name: 'add_task', args: { content: 'x' } }]))
      .mockReturnValueOnce(streamOf([
        { type: 'done', content: '好看。', emotion: 'happy', source: 'qwen', provider: 'qwen', model: 'vision-model' },
      ]))
    mocks.executeToolCall.mockResolvedValue({ deduplicated: false, tool: 'add_task', ok: true, summary: '已安排', feedback: '已执行' })

    await collectEvents(sendMessageStream('conversation-1', 'user-1', '', 'req-img-2', { image: IMAGE }))

    expect(mocks.generateResponseStream).toHaveBeenCalledTimes(2)
    expect(mocks.generateResponseStream.mock.calls[1][5].image).toBe(IMAGE)
    // 纯图消息：空 content 不进危机检测
    expect(mocks.detectCrisis).not.toHaveBeenCalled()
  })

  it('done 落库后图片落盘，userMessage 带 imageExt', async () => {
    const events = await collectEvents(sendMessageStream('conversation-1', 'user-1', '', 'req-img-3', { image: IMAGE }))

    const done = events.at(-1)
    expect(done.type).toBe('done')
    expect(mocks.saveChatImage).toHaveBeenCalledWith('user-1', 'user-message', IMAGE)
    expect(mocks.messageUpdate).toHaveBeenCalledWith({ where: { id: 'user-message' }, data: { imageExt: '.jpg' } })
    expect(done.userMessage.imageExt).toBe('.jpg')
  })

  it('写盘失败降级：按无图返回，不丢 AI 回复', async () => {
    mocks.saveChatImage.mockRejectedValue(new Error('disk full'))

    const events = await collectEvents(sendMessageStream('conversation-1', 'user-1', '看这身', 'req-img-4', { image: IMAGE }))

    const done = events.at(-1)
    expect(done.type).toBe('done')
    expect(done.userMessage.imageExt).toBeUndefined()
    expect(done.aiMessage.content).toBe('这身搭配好看。')
  })

  it('listConversations：纯图消息预览显示 [图片]', async () => {
    mocks.conversationFindMany.mockResolvedValue([
      { id: 'c1', messages: [{ id: 'm1', role: 'user', content: '', imageExt: '.jpg' }] },
      { id: 'c2', messages: [{ id: 'm2', role: 'user', content: '文字', imageExt: null }] },
    ])

    const result = await listConversations('user-1')

    expect(result[0].messages[0].content).toBe('[图片]')
    expect(result[1].messages[0].content).toBe('文字')
  })

  it('deleteConversation：先查图片消息，删除后 best-effort 清理落盘文件', async () => {
    mocks.conversationFindFirst.mockResolvedValue({ id: 'conversation-1', userId: 'user-1' })
    mocks.messageFindMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }])
    mocks.conversationDelete.mockResolvedValue({})

    await deleteConversation('conversation-1', 'user-1')

    expect(mocks.messageFindMany).toHaveBeenCalledWith({
      where: { conversationId: 'conversation-1', imageExt: { not: null } },
      select: { id: true },
    })
    expect(mocks.deleteChatImages).toHaveBeenCalledWith('user-1', ['m1', 'm2'])
  })
})


describe('chatService 滚动摘要', () => {
  const base = new Date(2026, 8, 10, 8, 0, 0)
  const buildAscending = (count) => Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `第${i + 1}条`,
    createdAt: new Date(base.getTime() + i * 60_000),
  }))
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.transaction.mockImplementation((callback) => callback({
      user: { findUnique: mocks.companionFindUnique, update: mocks.companionUpdate },
      $queryRaw: mocks.companionLock,
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
    mocks.memoryFindMany.mockResolvedValue([])
    mocks.memoryEdgeFindMany.mockResolvedValue([])
    mocks.embedQuery.mockResolvedValue(null)
    mocks.derivedInsightFindMany.mockResolvedValue([])
    mocks.messageCreate.mockImplementation(({ data }) => Promise.resolve({
      id: data.role === 'user' ? 'user-message' : 'ai-message',
      ...data,
    }))
    mocks.conversationUpdate.mockResolvedValue({})
    mocks.generateResponse.mockResolvedValue({
      content: '模型回复', emotion: 'neutral', source: 'local_model', provider: 'llamacpp', model: 'configured-model',
    })
    mocks.generateCompanionNote.mockResolvedValue({ content: '合并后的前情摘要' })
  })

  it('积压不足 10 条不触发压缩', async () => {
    mocks.conversationFindUnique.mockResolvedValue({ summary: null, summaryUpToAt: null })
    mocks.messageFindMany.mockResolvedValue(buildAscending(25)) // 25 - 19 = 6 条积压
    mocks.messageCount.mockResolvedValue(25)
    await sendMessage('conversation-1', 'user-1', '你好')
    await flush()
    const compressCalls = mocks.generateCompanionNote.mock.calls
      .filter((c) => String(c[0].instruction).includes('对话归档员'))
    expect(compressCalls).toHaveLength(0)
  })

  it('积压满 10 条时压缩最老批次并写回 summary 与 summaryUpToAt', async () => {
    mocks.conversationFindUnique.mockResolvedValue({ summary: null, summaryUpToAt: null })
    const messages = buildAscending(30) // 30 - 19 = 11 条积压
    mocks.messageFindMany.mockResolvedValue(messages)
    mocks.messageCount.mockResolvedValue(30)
    await sendMessage('conversation-1', 'user-1', '你好')
    await vi.waitFor(() => expect(
      mocks.generateCompanionNote.mock.calls.filter((c) => String(c[0].instruction).includes('对话归档员')),
    ).toHaveLength(1))

    const noteArgs = mocks.generateCompanionNote.mock.calls
      .find((c) => String(c[0].instruction).includes('对话归档员'))[0]
    expect(noteArgs.userText).not.toContain('已有前情摘要')
    expect(noteArgs.userText).toContain('第1条')
    expect(noteArgs.userText).toContain('第11条')
    expect(noteArgs.userText).not.toContain('第12条')
    // 只数、只取未摘要的部分，不再每轮读出整段历史
    expect(mocks.messageCount).toHaveBeenCalledWith({ where: { conversationId: 'conversation-1' } })
    expect(mocks.messageFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { conversationId: 'conversation-1' }, take: 11 }))

    await vi.waitFor(() => expect(mocks.conversationUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'conversation-1' },
      data: expect.objectContaining({
        summary: '合并后的前情摘要',
        summaryUpToAt: messages[10].createdAt,
      }),
    })))
  })

  it('已有摘要时并入新对话生成更新摘要；已覆盖的消息不重复压缩', async () => {
    const coveredAt = new Date(base.getTime() + 4 * 60_000)
    mocks.conversationFindUnique.mockResolvedValue({ summary: '旧摘要', summaryUpToAt: coveredAt })
    mocks.messageFindMany.mockResolvedValue(buildAscending(34)) // 34-19=15 条积压，扣除已覆盖 5 条剩 10 条
    mocks.messageCount.mockResolvedValue(29) // 数据库只数摘要之后的 29 条
    await sendMessage('conversation-1', 'user-1', '你好')
    await vi.waitFor(() => expect(
      mocks.generateCompanionNote.mock.calls.filter((c) => String(c[0].instruction).includes('对话归档员')),
    ).toHaveLength(1))

    const noteArgs = mocks.generateCompanionNote.mock.calls
      .find((c) => String(c[0].instruction).includes('对话归档员'))[0]
    expect(noteArgs.userText).toContain('已有前情摘要：\n旧摘要')
    expect(noteArgs.userText).not.toContain('第5条')
    expect(noteArgs.userText).toContain('第6条')
  })

  it('压缩模型调用失败静默降级，不影响聊天', async () => {
    mocks.conversationFindUnique.mockResolvedValue({ summary: null, summaryUpToAt: null })
    mocks.messageFindMany.mockResolvedValue(buildAscending(30))
    mocks.messageCount.mockResolvedValue(30)
    mocks.generateCompanionNote.mockRejectedValue(new Error('provider down'))
    const result = await sendMessage('conversation-1', 'user-1', '你好')
    await flush()
    expect(result.status).toBe('ok')
    expect(mocks.conversationUpdate).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ summary: expect.anything() }),
    }))
  })

  it('会话已有摘要时以 system 消息注入 extraSystem', async () => {
    mocks.conversationFindUnique.mockResolvedValue({ summary: '她下周要面试', summaryUpToAt: null })
    mocks.messageFindMany.mockResolvedValue([])
    await sendMessage('conversation-1', 'user-1', '我睡不着')
    const options = mocks.generateResponse.mock.calls[0][5]
    const summaryBlock = options.extraSystem.find((m) => String(m.content).includes('【前情摘要】'))
    expect(summaryBlock.content).toContain('她下周要面试')
  })
})

describe('chatService.executeScheduledTask 未接入防御门', () => {
  beforeEach(() => vi.clearAllMocks())
  it('直接调用也不会读取私有上下文、嵌入、执行工具或落库', async () => {
    mocks.userFindUnique.mockResolvedValue({ persona: 'toxic', externalLlmConsent: true, externalLlmConsentVersion: EXTERNAL_LLM_CONSENT_VERSION })
    await expect(executeScheduledTask('user-1', '总结日记', 'req-task')).rejects.toMatchObject({ statusCode: 503, code: 'WORK_CLOUD_NOT_CONNECTED' })
    expect(mocks.userFindUnique).not.toHaveBeenCalled()
    expect(mocks.embedQuery).not.toHaveBeenCalled()
    expect(mocks.memoryFindMany).not.toHaveBeenCalled()
    expect(mocks.generateResponse).not.toHaveBeenCalled()
    expect(mocks.executeToolCall).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

describe('chatService 只有一段对话', () => {
  const buildTx = () => ({
    $queryRaw: vi.fn(() => Promise.resolve([{ id: 'user-1' }])),
    conversation: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn(() => Promise.resolve({ count: 0 })), update: vi.fn(() => Promise.resolve({})) },
    message: { updateMany: vi.fn(() => Promise.resolve({ count: 0 })), findFirst: vi.fn(() => Promise.resolve(null)) },
    workTask: { updateMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    workArtifact: { updateMany: vi.fn(() => Promise.resolve({ count: 0 })) },
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.conversationFindFirst.mockResolvedValue({ id: 'thread-1', userId: 'user-1', messages: [] })
  })

  it('已经只有一段时直接读取，不加锁也不改数据', async () => {
    mocks.conversationFindMany.mockResolvedValue([{ id: 'thread-1' }])

    const thread = await getThread('user-1', { page: 2, limit: 30 })

    expect(thread.id).toBe('thread-1')
    expect(mocks.conversationFindMany).toHaveBeenCalledWith({ where: { userId: 'user-1', archivedAt: null }, select: { id: true } })
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.conversationFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'thread-1', userId: 'user-1' } }))
  })

  it('一段都没有时在锁内创建', async () => {
    mocks.conversationFindMany.mockResolvedValue([])
    const tx = buildTx()
    tx.conversation.findMany.mockResolvedValue([])
    tx.conversation.create.mockResolvedValue({ id: 'thread-new' })
    mocks.transaction.mockImplementationOnce((callback) => callback(tx))
    mocks.conversationFindFirst.mockResolvedValue({ id: 'thread-new', userId: 'user-1', messages: [] })

    expect((await getThread('user-1')).id).toBe('thread-new')
    expect(tx.$queryRaw).toHaveBeenCalled()
    expect(tx.conversation.create).toHaveBeenCalledWith({ data: { userId: 'user-1', title: 'Amie', mode: 'chat' } })
  })

  it('升级前的多段未归档会话合进最近活跃的那段；归档的不动，摘要只覆盖最新 19 条之外', async () => {
    mocks.conversationFindMany.mockResolvedValue([{ id: 'old' }, { id: 'recent' }])
    const covered = new Date('2026-09-10T00:00:00.000Z')
    const boundary = new Date('2026-09-18T00:00:00.000Z')
    const tx = buildTx()
    tx.conversation.findMany.mockResolvedValue([{ id: 'recent', summaryUpToAt: covered }, { id: 'old', summaryUpToAt: null }, { id: 'older', summaryUpToAt: null }])
    tx.message.updateMany.mockResolvedValue({ count: 42 })
    tx.message.findFirst.mockResolvedValue({ createdAt: boundary })
    mocks.transaction.mockImplementationOnce((callback) => callback(tx))
    mocks.conversationFindFirst.mockResolvedValue({ id: 'recent', userId: 'user-1', messages: [] })

    expect((await getThread('user-1')).id).toBe('recent')

    expect(tx.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1', archivedAt: null } }))
    for (const model of [tx.message, tx.workTask, tx.workArtifact]) {
      expect(model.updateMany).toHaveBeenCalledWith({ where: { conversationId: { in: ['old', 'older'] } }, data: { conversationId: 'recent' } })
    }
    expect(tx.conversation.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['old', 'older'] }, userId: 'user-1' } })
    expect(tx.message.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { conversationId: 'recent' }, skip: 19 }))
    expect(tx.conversation.update).toHaveBeenCalledWith({ where: { id: 'recent' }, data: { mode: 'chat', summaryUpToAt: boundary } })
  })

  it('并发的另一次打开已经合并完时，锁内复查后不再改数据', async () => {
    mocks.conversationFindMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    const tx = buildTx()
    tx.conversation.findMany.mockResolvedValue([{ id: 'a', summaryUpToAt: null }])
    mocks.transaction.mockImplementationOnce((callback) => callback(tx))

    await getThread('user-1')

    expect(tx.message.updateMany).not.toHaveBeenCalled()
    expect(tx.conversation.deleteMany).not.toHaveBeenCalled()
  })

  it('清空聊天记录只删这段对话的消息与图片，并清掉前情摘要', async () => {
    mocks.conversationFindMany.mockResolvedValue([{ id: 'thread-1' }])
    mocks.messageFindMany.mockResolvedValue([{ id: 'img-1' }])
    mocks.messageDeleteMany.mockReturnValue(Promise.resolve({ count: 7 }))
    mocks.conversationUpdate.mockReturnValue(Promise.resolve({}))
    mocks.transaction.mockImplementationOnce((operations) => Promise.all(operations))
    mocks.deleteChatImages.mockResolvedValue()

    expect(await clearThread('user-1')).toEqual({ success: true, conversationId: 'thread-1' })
    expect(mocks.messageDeleteMany).toHaveBeenCalledWith({ where: { conversationId: 'thread-1' } })
    expect(mocks.conversationUpdate).toHaveBeenCalledWith({ where: { id: 'thread-1' }, data: { summary: null, summaryUpToAt: null } })
    expect(mocks.deleteChatImages).toHaveBeenCalledWith('user-1', ['img-1'])
  })
})

describe('伴读问答：书里的原文作为资料进上下文', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.transaction.mockImplementation((callback) => callback({
      user: { findUnique: mocks.companionFindUnique, update: mocks.companionUpdate },
      $queryRaw: mocks.companionLock,
      message: { create: mocks.messageCreate },
      conversation: { update: mocks.conversationUpdate },
      crisisLog: { create: mocks.crisisCreate },
    }))
    mocks.conversationFindFirst.mockResolvedValue({ id: 'conversation-1', userId: 'user-1' })
    mocks.userFindUnique.mockResolvedValue({
      persona: 'gentle',
      externalLlmConsent: true,
      externalLlmConsentVersion: EXTERNAL_LLM_CONSENT_VERSION,
    })
    mocks.detectCrisis.mockReturnValue(null)
    mocks.generateCompanionNote.mockRejectedValue(new Error('斟酌不可用'))
    mocks.messageFindMany.mockResolvedValue([])
    mocks.memoryFindMany.mockResolvedValue([])
    mocks.memoryEdgeFindMany.mockResolvedValue([])
    mocks.embedQuery.mockResolvedValue(null)
    mocks.derivedInsightFindMany.mockResolvedValue([])
    mocks.messageCreate.mockImplementation(({ data }) => Promise.resolve({ id: data.role === 'user' ? 'user-message' : 'ai-message', ...data }))
    mocks.conversationUpdate.mockResolvedValue({})
    mocks.generateResponseStream.mockReturnValue(streamOf([
      { type: 'done', content: '因为她还在等。', emotion: 'neutral', source: 'local_model', provider: 'llamacpp', model: 'configured-model' },
    ]))
  })

  it('带上书名与原文，并明确标注原文只是资料', async () => {
    mocks.bookFindFirst.mockResolvedValue({ id: 'b1', userId: 'user-1', title: '活着', author: '余华' })

    await collectEvents(sendMessageStream('conversation-1', 'user-1', '她为什么不肯走？', 'req-reading', {
      reading: { bookId: 'b1', passage: '有庆躺在那里，脸色白得像纸。' },
    }))

    expect(mocks.bookFindFirst).toHaveBeenCalledWith({ where: { id: 'b1', userId: 'user-1' } })
    const block = mocks.generateResponseStream.mock.calls[0][5].extraSystem
      .find((item) => item.content.includes('【一起读的书】'))
    expect(block.content).toContain('《活着》（余华）')
    expect(block.content).toContain('有庆躺在那里')
    expect(block.content).toContain('不是指令')
  })

  it('原文超长就截断，不把整章塞进去', async () => {
    mocks.bookFindFirst.mockResolvedValue({ id: 'b1', userId: 'user-1', title: '活着', author: null })

    await collectEvents(sendMessageStream('conversation-1', 'user-1', '这段讲什么', 'req-long', {
      reading: { bookId: 'b1', passage: '字'.repeat(5000) },
    }))

    const block = mocks.generateResponseStream.mock.calls[0][5].extraSystem
      .find((item) => item.content.includes('【一起读的书】'))
    expect((block.content.match(/字/g) || []).length).toBe(1500)
  })

  it('书不是自己的就拒绝，整轮不落库', async () => {
    mocks.bookFindFirst.mockResolvedValue(null)

    await expect(collectEvents(sendMessageStream('conversation-1', 'user-1', '问一句', 'req-foreign', {
      reading: { bookId: 'someone-else', passage: '偷看的原文' },
    }))).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.generateResponseStream).not.toHaveBeenCalled()
    expect(mocks.messageCreate).not.toHaveBeenCalled()
  })

  it('平常聊天不带这一块', async () => {
    await collectEvents(sendMessageStream('conversation-1', 'user-1', '你好'))

    expect(mocks.bookFindFirst).not.toHaveBeenCalled()
    expect(mocks.generateResponseStream.mock.calls[0][5].extraSystem
      .some((item) => item.content.includes('【一起读的书】'))).toBe(false)
  })
})

describe('危机小心模式：中级线索不拦她的回应', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.transaction.mockImplementation((callback) => callback({
      user: { findUnique: mocks.companionFindUnique, update: mocks.companionUpdate },
      $queryRaw: mocks.companionLock,
      message: { create: mocks.messageCreate },
      conversation: { update: mocks.conversationUpdate },
      crisisLog: { create: mocks.crisisCreate },
    }))
    mocks.conversationFindFirst.mockResolvedValue({ id: 'conversation-1', userId: 'user-1' })
    mocks.userFindUnique.mockResolvedValue({
      persona: 'gentle',
      externalLlmConsent: true,
      externalLlmConsentVersion: EXTERNAL_LLM_CONSENT_VERSION,
    })
    mocks.detectCrisis.mockReturnValue('medium')
    mocks.generateCompanionNote.mockRejectedValue(new Error('斟酌不可用'))
    mocks.messageFindMany.mockResolvedValue([])
    mocks.memoryFindMany.mockResolvedValue([])
    mocks.memoryEdgeFindMany.mockResolvedValue([])
    mocks.embedQuery.mockResolvedValue(null)
    mocks.derivedInsightFindMany.mockResolvedValue([])
    mocks.messageCreate.mockImplementation(({ data }) => Promise.resolve({ id: data.role === 'user' ? 'user-message' : 'ai-message', ...data }))
    mocks.conversationUpdate.mockResolvedValue({})
    mocks.crisisCreate.mockResolvedValue({ id: 'crisis-1' })
    mocks.generateResponseStream.mockReturnValue(streamOf([
      { type: 'done', content: '我在。今天是哪件事把你压成这样？', emotion: 'concerned', source: 'qwen', provider: 'qwen', model: 'm' },
    ]))
  })

  const carefulBlock = () => mocks.generateResponseStream.mock.calls[0][5].extraSystem
    .find((item) => item.content.includes('【这一轮请格外小心】'))

  it('「活着好累」照常得到她的回应，这一轮带着小心模式', async () => {
    const events = await collectEvents(sendMessageStream('conversation-1', 'user-1', '活着好累', 'req-careful'))

    expect(events.at(-1)).toMatchObject({ type: 'done', status: 'ok' })
    expect(events.some((event) => event.type === 'blocked')).toBe(false)
    expect(carefulBlock().content).toContain('先接住她的感受')
    expect(carefulBlock().content).toContain('不编造任何热线号码')
  })

  it('小心模式这一轮只是倾诉，不塞工具目录', async () => {
    await collectEvents(sendMessageStream('conversation-1', 'user-1', '活着好累', 'req-careful-tools'))
    const contents = mocks.generateResponseStream.mock.calls[0][5].extraSystem.map((item) => item.content)
    expect(contents.some((content) => content.includes('add_task'))).toBe(false)
    expect(contents.at(-1)).toContain('这一轮是聊天')
  })

  it('中级只记一笔、不存原文，也不算走了固定干预', async () => {
    await collectEvents(sendMessageStream('conversation-1', 'user-1', '没人爱我', 'req-careful-log'))

    expect(mocks.crisisCreate).toHaveBeenCalledWith({ data: { userId: 'user-1', triggerMsg: null, level: 'medium', handled: false } })
  })

  it('记录写不进去也不打断这一轮', async () => {
    mocks.crisisCreate.mockRejectedValue(new Error('db down'))

    const events = await collectEvents(sendMessageStream('conversation-1', 'user-1', '我是个废物', 'req-careful-db'))

    expect(events.at(-1)).toMatchObject({ type: 'done', status: 'ok' })
  })

  it('没同意云端模型时退回固定关怀，不让人撞上同意墙', async () => {
    mocks.userFindUnique.mockResolvedValue({ persona: 'gentle', externalLlmConsent: false, externalLlmConsentVersion: null })

    const events = await collectEvents(sendMessageStream('conversation-1', 'user-1', '活着好累', 'req-careful-noconsent'))

    expect(events).toEqual([expect.objectContaining({ type: 'blocked', status: 'blocked' })])
    expect(mocks.generateResponseStream).not.toHaveBeenCalled()
  })

  it('明确的自伤意图（高级）仍然整轮拦下', async () => {
    mocks.detectCrisis.mockReturnValue('high')

    const events = await collectEvents(sendMessageStream('conversation-1', 'user-1', '我不想活了', 'req-high'))

    expect(events).toEqual([expect.objectContaining({ type: 'blocked', status: 'blocked' })])
    expect(mocks.generateResponseStream).not.toHaveBeenCalled()
  })

  it('平常的话不带小心模式', async () => {
    mocks.detectCrisis.mockReturnValue(null)

    await collectEvents(sendMessageStream('conversation-1', 'user-1', '今天吃了火锅', 'req-plain'))

    expect(carefulBlock()).toBeUndefined()
    expect(mocks.crisisCreate).not.toHaveBeenCalled()
  })
})

describe('她认得你：每轮都在的上下文', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.transaction.mockImplementation((callback) => callback({
      user: { findUnique: mocks.companionFindUnique, update: mocks.companionUpdate },
      $queryRaw: mocks.companionLock,
      message: { create: mocks.messageCreate },
      conversation: { update: mocks.conversationUpdate },
      crisisLog: { create: mocks.crisisCreate },
    }))
    mocks.conversationFindFirst.mockResolvedValue({ id: 'conversation-1', userId: 'user-1' })
    mocks.userFindUnique.mockResolvedValue({
      persona: 'gentle',
      nickname: '小鱼',
      birthDate: null,
      externalLlmConsent: true,
      externalLlmConsentVersion: EXTERNAL_LLM_CONSENT_VERSION,
    })
    mocks.detectCrisis.mockReturnValue(null)
    mocks.messageFindMany.mockResolvedValue([])
    mocks.memoryFindMany.mockResolvedValue([
      { id: 'pinned-1', revision: 1, content: '我对芒果过敏', type: 'semantic', importance: 5, tags: null, pinned: true },
      { id: 'plain-1', revision: 1, content: '喜欢下雨天', type: 'semantic', importance: 5, tags: null, pinned: false },
    ])
    mocks.memoryEdgeFindMany.mockResolvedValue([])
    mocks.embedQuery.mockResolvedValue(null)
    mocks.retrieveRelevantMemories.mockReturnValue([])
    mocks.describeRecentNudges.mockResolvedValue([{ kind: 'reminder', content: '该喝水啦' }])
    mocks.messageCreate.mockImplementation(({ data }) => Promise.resolve({ id: data.role === 'user' ? 'user-message' : 'ai-message', ...data }))
    mocks.conversationUpdate.mockResolvedValue({})
    mocks.generateResponseStream.mockReturnValue(streamOf([
      { type: 'done', content: '好呀', emotion: 'neutral', source: 'qwen', provider: 'qwen', model: 'm' },
    ]))
  })

  const blockWith = (marker) => mocks.generateResponseStream.mock.calls[0][5].extraSystem
    .find((item) => item.content.includes(marker))

  it('称呼、放在心上的事、此刻、她今天说过的话都在', async () => {
    await collectEvents(sendMessageStream('conversation-1', 'user-1', '好的', 'req-knows'))

    expect(blockWith('【关于她】').content).toContain('她希望你叫她「小鱼」')
    expect(blockWith('【关于她】').content).toContain('我对芒果过敏')
    expect(blockWith('【此刻】').content).toContain('北京时间')
    expect(blockWith('【你今天主动对她说过】').content).toContain('该喝水啦')
  })

  it('放在心上的那几条不再挤进「相关记忆」的检索里', async () => {
    await collectEvents(sendMessageStream('conversation-1', 'user-1', '今天吃什么', 'req-pinned'))

    const searched = mocks.retrieveRelevantMemories.mock.calls[0][1].map((memory) => memory.id)
    expect(searched).toEqual(['plain-1'])
  })

  it('上一句话的时间来自已加载的历史，不多查库', async () => {
    mocks.messageFindMany.mockResolvedValue([{ role: 'assistant', content: '晚安', createdAt: new Date(Date.now() - 3 * 86400000) }])

    await collectEvents(sendMessageStream('conversation-1', 'user-1', '我回来啦', 'req-gap'))

    expect(blockWith('【此刻】').content).toContain('3 天前')
    // 时间只用来算间隔，不跟着历史消息一起交给模型
    expect(mocks.generateResponseStream.mock.calls[0][2][0]).not.toHaveProperty('createdAt')
  })

  it('说「帮我记住…」的那一轮：告诉她确认卡在下面，并让界面自动打开', async () => {
    const events = await collectEvents(sendMessageStream('conversation-1', 'user-1', '帮我记住我对芒果过敏', 'req-remember'))

    expect(blockWith('【她想让你记住一件事】')).toBeDefined()
    expect(events.at(-1)).toMatchObject({ type: 'done', offerMemory: true })
  })

  it('平常的一轮不带这两样', async () => {
    const events = await collectEvents(sendMessageStream('conversation-1', 'user-1', '今天下雨了', 'req-plain'))

    expect(blockWith('【她想让你记住一件事】')).toBeUndefined()
    expect(events.at(-1)).toMatchObject({ type: 'done', offerMemory: false })
  })

  it('她今天说过的话取不到也不耽误聊天', async () => {
    mocks.describeRecentNudges.mockResolvedValue([])

    const events = await collectEvents(sendMessageStream('conversation-1', 'user-1', '在吗', 'req-quiet'))

    expect(events.at(-1)).toMatchObject({ type: 'done' })
    expect(blockWith('【你今天主动对她说过】')).toBeUndefined()
  })
})

describe('「懂你」检验集（冻结）', () => {
  // 场景与期望冻结在 tests/knows-you/knows-you.cases.json：改期望要产品负责人确认，不在实现里默默改。
  // 这里只看拼给模型的那段上下文里有什么、没有什么——不调模型、不花钱、进 CI。
  const suite = JSON.parse(readFileSync(new URL('../../tests/knows-you/knows-you.cases.json', import.meta.url), 'utf8'))
  const day = 24 * 60 * 60 * 1000

  const userOf = (given = {}) => ({
    persona: given.persona ?? 'gentle',
    nickname: given.nickname ?? null,
    birthDate: null,
    externalLlmConsent: true,
    externalLlmConsentVersion: EXTERNAL_LLM_CONSENT_VERSION,
    periodConsentAt: given.periodConsent ? new Date('2026-09-01T00:00:00.000Z') : null,
    periodToneAt: given.periodConsent ? new Date('2026-09-01T00:00:00.000Z') : null,
  })

  const contextOf = () => (mocks.generateResponseStream.mock.calls[0]?.[5].extraSystem ?? [])
    .map((item) => item.content).join('\n')

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.transaction.mockImplementation((callback) => callback({
      user: { findUnique: mocks.companionFindUnique, update: mocks.companionUpdate },
      $queryRaw: mocks.companionLock,
      message: { create: mocks.messageCreate },
      conversation: { update: mocks.conversationUpdate },
      crisisLog: { create: mocks.crisisCreate },
    }))
    mocks.conversationFindFirst.mockResolvedValue({ id: 'conversation-1', userId: 'user-1' })
    mocks.userFindUnique.mockResolvedValue(userOf())
    mocks.detectCrisis.mockReturnValue(null)
    mocks.messageFindMany.mockResolvedValue([])
    mocks.memoryFindMany.mockResolvedValue([])
    mocks.memoryEdgeFindMany.mockResolvedValue([])
    mocks.derivedInsightFindMany.mockResolvedValue([])
    mocks.embedQuery.mockResolvedValue(null)
    mocks.retrieveRelevantMemories.mockReturnValue([])
    mocks.describeRecentNudges.mockResolvedValue([])
    mocks.diaryFindMany.mockResolvedValue([])
    mocks.periodFindFirst.mockResolvedValue(null)
    mocks.messageCreate.mockImplementation(({ data }) => Promise.resolve({ id: data.role === 'user' ? 'user-message' : 'ai-message', ...data }))
    mocks.conversationUpdate.mockResolvedValue({})
    mocks.crisisCreate.mockResolvedValue({ id: 'crisis-1' })
    mocks.generateResponseStream.mockReturnValue(streamOf([
      { type: 'done', content: '嗯，我在。', emotion: 'neutral', source: 'qwen', provider: 'qwen', model: 'm' },
    ]))
  })

  it('检验集本身是冻结的：版本、场景与期望都齐全', () => {
    expect(suite.version).toBe(1)
    expect(suite.cases.length).toBeGreaterThanOrEqual(8)
    for (const item of suite.cases) {
      expect(item.id).toBeTruthy()
      expect(item.title).toBeTruthy()
      expect(item.text).toBeTruthy()
      expect(Array.isArray(item.expect.contain)).toBe(true)
      expect(Array.isArray(item.expect.absent)).toBe(true)
    }
  })

  for (const scenario of suite.cases) {
    it(`${scenario.id}｜${scenario.title}`, async () => {
      const given = scenario.given ?? {}
      mocks.userFindUnique.mockResolvedValue(userOf(given))
      if (given.memories) mocks.memoryFindMany.mockResolvedValue(given.memories)
      if (given.nudges) mocks.describeRecentNudges.mockResolvedValue(given.nudges.map((content, index) => ({ id: `nudge-${index}`, kind: 'reminder', content })))
      if (given.lastMessageDaysAgo) {
        mocks.messageFindMany.mockResolvedValue([{ role: 'assistant', content: '晚安', createdAt: new Date(Date.now() - given.lastMessageDaysAgo * day) }])
      }
      if (given.crisis) mocks.detectCrisis.mockReturnValue(given.crisis)
      if (given.periodRecord) mocks.periodFindFirst.mockResolvedValue({ startDate: new Date(Date.now() - 2 * day), endDate: null })

      await collectEvents(sendMessageStream('conversation-1', 'user-1', scenario.text, `req-${scenario.id}`))

      if (scenario.expect.model === false) {
        expect(mocks.generateResponseStream).not.toHaveBeenCalled()
        expect(mocks.generateResponse).not.toHaveBeenCalled()
        return
      }
      const context = contextOf()
      expect(context).not.toBe('')
      for (const marker of scenario.expect.contain) expect(context).toContain(marker)
      for (const marker of scenario.expect.absent) expect(context).not.toContain(marker)
      // 没同意的事连读都不读：数据在那儿也不碰
      for (const unread of scenario.expect.unread ?? []) {
        if (unread === 'periodRecord') expect(mocks.periodFindFirst).not.toHaveBeenCalled()
      }
    })
  }
})
