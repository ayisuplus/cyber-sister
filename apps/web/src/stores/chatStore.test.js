import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/chatService', () => ({
  chatService: {
    getConversations: vi.fn(),
    getConversation: vi.fn(),
    createConversation: vi.fn(),
    sendMessage: vi.fn(),
    deleteConversation: vi.fn(),
  },
}))

import { chatService } from '../services/chatService'
import { useChatStore } from './chatStore'

const resetStore = () => useChatStore.setState({
  conversations: [],
  currentConversationId: null,
  messages: [],
  isTyping: false,
  isSending: false,
})

describe('chatStore', () => {
  beforeEach(resetStore)

  it('loads the complete selected conversation instead of its preview', async () => {
    const messages = [
      { id: 'm1', role: 'user', content: '第一条' },
      { id: 'm2', role: 'assistant', content: '第二条' },
    ]
    chatService.getConversations.mockResolvedValue([{ id: 'c1', messages: [messages[1]] }])
    chatService.getConversation.mockResolvedValue({ id: 'c1', messages })

    await useChatStore.getState().loadConversations()

    expect(chatService.getConversation).toHaveBeenCalledWith('c1')
    expect(useChatStore.getState().messages).toEqual(messages)
  })

  it('keeps a persisted response source in the current UI state', async () => {
    useChatStore.setState({ currentConversationId: 'c1' })
    chatService.sendMessage.mockResolvedValue({
      status: 'ok',
      source: 'local_template',
      userMessage: { id: 'u1', role: 'user', content: '你好' },
      aiMessage: { id: 'a1', role: 'assistant', content: '本地回复' },
    })

    const result = await useChatStore.getState().sendMessage('你好')

    expect(result).toEqual({ status: 'ok', source: 'local_template' })
    expect(useChatStore.getState().messages).toHaveLength(2)
    expect(useChatStore.getState().messages[1]).toMatchObject({ source: 'local_template' })
  })

  it('adds one blocked intervention without fabricating an AI response', async () => {
    useChatStore.setState({ currentConversationId: 'c1' })
    chatService.sendMessage.mockResolvedValue({
      status: 'blocked',
      userMessage: { id: 'u1', role: 'user', content: '危机输入' },
      intervention: { level: 'high', message: '固定干预文案', resources: [] },
    })

    const result = await useChatStore.getState().sendMessage('危机输入')

    expect(result.status).toBe('blocked')
    expect(useChatStore.getState().messages.map(message => message.content)).toEqual([
      '危机输入',
      '固定干预文案',
    ])
  })

  it('does not append a failed message and resets the sending flag', async () => {
    useChatStore.setState({
      currentConversationId: 'c1',
      messages: [{ id: 'existing', role: 'assistant', content: '已有消息' }],
    })
    chatService.sendMessage.mockRejectedValue(new Error('LLM unavailable'))

    await expect(useChatStore.getState().sendMessage('需要重试')).rejects.toThrow('LLM unavailable')
    expect(useChatStore.getState().messages).toEqual([
      { id: 'existing', role: 'assistant', content: '已有消息' },
    ])
    expect(useChatStore.getState().isSending).toBe(false)
  })
})
describe('chatStore conversation management', () => {
  beforeEach(resetStore)

  it('keeps the empty state when the conversation list fails to load', async () => {
    chatService.getConversations.mockRejectedValue(new Error('offline'))

    await useChatStore.getState().loadConversations()

    expect(useChatStore.getState().conversations).toEqual([])
    expect(chatService.getConversation).not.toHaveBeenCalled()
  })

  it('creates a conversation and makes it current', async () => {
    chatService.createConversation.mockResolvedValue({ id: 'c9', title: '新会话' })

    const conversation = await useChatStore.getState().createConversation()

    expect(conversation.id).toBe('c9')
    expect(useChatStore.getState()).toMatchObject({
      currentConversationId: 'c9',
      messages: [],
    })
    expect(useChatStore.getState().conversations[0].id).toBe('c9')
  })

  it('creates a conversation on the fly when sending without one', async () => {
    chatService.createConversation.mockResolvedValue({ id: 'c-new' })
    chatService.sendMessage.mockResolvedValue({
      status: 'ok',
      userMessage: { id: 'u1', role: 'user', content: '第一条' },
      aiMessage: { id: 'a1', role: 'assistant', content: '回复' },
    })

    const result = await useChatStore.getState().sendMessage('第一条')

    expect(chatService.createConversation).toHaveBeenCalled()
    expect(chatService.sendMessage).toHaveBeenCalledWith('c-new', '第一条')
    expect(result.status).toBe('ok')
  })

  it('ignores blank or concurrent sends', async () => {
    useChatStore.setState({ currentConversationId: 'c1' })

    await useChatStore.getState().sendMessage('   ')
    expect(chatService.sendMessage).not.toHaveBeenCalled()

    useChatStore.setState({ isSending: true })
    await useChatStore.getState().sendMessage('并发')
    expect(chatService.sendMessage).not.toHaveBeenCalled()
  })

  it('keeps previous messages when switching to a conversation that fails to load', async () => {
    useChatStore.setState({ messages: [{ id: 'keep', role: 'user', content: '保留' }] })
    chatService.getConversation.mockRejectedValue(new Error('offline'))

    await useChatStore.getState().setCurrentConversation('c2')

    expect(useChatStore.getState().currentConversationId).toBe('c2')
    expect(useChatStore.getState().messages).toEqual([{ id: 'keep', role: 'user', content: '保留' }])
  })

  it('moves to the next conversation after deleting the current one', async () => {
    useChatStore.setState({
      conversations: [{ id: 'c1' }, { id: 'c2' }],
      currentConversationId: 'c1',
      messages: [{ id: 'm1' }],
    })
    chatService.deleteConversation.mockResolvedValue({})
    chatService.getConversation.mockResolvedValue({ id: 'c2', messages: [{ id: 'm2' }] })

    await useChatStore.getState().deleteConversation('c1')

    expect(useChatStore.getState().conversations.map(c => c.id)).toEqual(['c2'])
    expect(useChatStore.getState().currentConversationId).toBe('c2')
    expect(useChatStore.getState().messages).toEqual([{ id: 'm2' }])
  })

  it('clears selection when the last conversation is deleted', async () => {
    useChatStore.setState({
      conversations: [{ id: 'c1' }],
      currentConversationId: 'c1',
      messages: [{ id: 'm1' }],
    })
    chatService.deleteConversation.mockResolvedValue({})

    await useChatStore.getState().deleteConversation('c1')

    expect(useChatStore.getState()).toMatchObject({
      conversations: [],
      currentConversationId: null,
      messages: [],
    })
  })

  it('keeps messages when deleting a background conversation', async () => {
    useChatStore.setState({
      conversations: [{ id: 'c1' }, { id: 'c2' }],
      currentConversationId: 'c1',
      messages: [{ id: 'm1' }],
    })
    chatService.deleteConversation.mockResolvedValue({})

    await useChatStore.getState().deleteConversation('c2')

    expect(useChatStore.getState().currentConversationId).toBe('c1')
    expect(useChatStore.getState().messages).toEqual([{ id: 'm1' }])
  })

  it('clears messages and resets the whole store', () => {
    useChatStore.setState({
      conversations: [{ id: 'c1' }],
      currentConversationId: 'c1',
      messages: [{ id: 'm1' }],
      isTyping: true,
    })

    useChatStore.getState().clearMessages()
    expect(useChatStore.getState().messages).toEqual([])
    expect(useChatStore.getState().currentConversationId).toBe('c1')

    useChatStore.getState().reset()
    expect(useChatStore.getState()).toMatchObject({
      conversations: [],
      currentConversationId: null,
      messages: [],
      isTyping: false,
      isSending: false,
    })
  })
})

describe('chatStore stale response guards', () => {
  beforeEach(resetStore)

  it('does not append a late reply into a conversation the user already left', async () => {
    const updatedAtBefore = '2026-08-01T00:00:00.000Z'
    useChatStore.setState({
      conversations: [{ id: 'c1', updatedAt: updatedAtBefore }, { id: 'c2', updatedAt: updatedAtBefore }],
      currentConversationId: 'c1',
      messages: [],
    })
    let resolveSend
    chatService.sendMessage.mockImplementation(() => new Promise((resolve) => { resolveSend = resolve }))

    const sendPromise = useChatStore.getState().sendMessage('在 c1 里发的消息')
    // 响应未回来时用户切到了 c2
    useChatStore.setState({ currentConversationId: 'c2', messages: [{ id: 'm-c2', content: 'c2 的消息' }] })

    resolveSend({
      status: 'ok',
      userMessage: { id: 'u1', role: 'user', content: '在 c1 里发的消息' },
      aiMessage: { id: 'a1', role: 'assistant', content: '迟到的回复' },
    })
    const result = await sendPromise

    expect(result.status).toBe('ok')
    // 迟到的消息不污染当前会话视图
    expect(useChatStore.getState().messages).toEqual([{ id: 'm-c2', content: 'c2 的消息' }])
    // 但会话列表的更新时间仍按目标会话刷新
    expect(useChatStore.getState().conversations[0].updatedAt).not.toBe(updatedAtBefore)
    expect(useChatStore.getState().isSending).toBe(false)
  })

  it('does not show a blocked intervention in a conversation the user already left', async () => {
    useChatStore.setState({
      conversations: [{ id: 'c1' }, { id: 'c2' }],
      currentConversationId: 'c1',
      messages: [],
    })
    let resolveSend
    chatService.sendMessage.mockImplementation(() => new Promise((resolve) => { resolveSend = resolve }))

    const sendPromise = useChatStore.getState().sendMessage('危机输入')
    useChatStore.setState({ currentConversationId: 'c2', messages: [{ id: 'm-c2' }] })
    resolveSend({
      status: 'blocked',
      userMessage: { id: 'u1', role: 'user', content: '危机输入' },
      intervention: { level: 'high', message: '干预文案', resources: [] },
    })
    const result = await sendPromise

    expect(result.status).toBe('blocked')
    expect(useChatStore.getState().messages).toEqual([{ id: 'm-c2' }])
  })

  it('discards a conversation fetch that resolves after the user switched away', async () => {
    useChatStore.setState({ messages: [{ id: 'keep' }] })
    let resolveFirst
    chatService.getConversation.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve }),
    )

    const switchPromise = useChatStore.getState().setCurrentConversation('c1')
    // 慢响应未回来时用户又切到 c2
    useChatStore.setState({ currentConversationId: 'c2' })
    resolveFirst({ id: 'c1', messages: [{ id: 'stale' }] })
    await switchPromise

    expect(useChatStore.getState().messages).toEqual([{ id: 'keep' }])
  })

  it('discards the auto-selected conversation payload if the user picked another one meanwhile', async () => {
    chatService.getConversations.mockResolvedValue([{ id: 'c1' }])
    let resolveFetch
    chatService.getConversation.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFetch = resolve }),
    )

    const loadPromise = useChatStore.getState().loadConversations()
    // 等 loadConversations 自动选中 c1 并发起消息拉取
    await vi.waitFor(() => expect(chatService.getConversation).toHaveBeenCalledWith('c1'))
    // 消息返回前，用户手动切到了 c2
    useChatStore.setState({ currentConversationId: 'c2', messages: [{ id: 'mine' }] })
    resolveFetch({ id: 'c1', messages: [{ id: 'stale' }] })
    await loadPromise

    expect(useChatStore.getState().messages).toEqual([{ id: 'mine' }])
  })
})
