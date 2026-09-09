import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/chatService', () => ({
  chatService: {
    getConversations: vi.fn(),
    getConversation: vi.fn(),
    createConversation: vi.fn(),
    streamMessage: vi.fn(),
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
  chatMode: 'chat',
})

// 让 streamMessage 按脚本逐事件回调后 resolve
const streamScript = (events) => (conversationId, content, { onEvent }) => {
  for (const event of events) onEvent(event)
  return Promise.resolve()
}

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

  it('streams deltas into a temporary bubble, replaces them on replace, and swaps in persisted messages on done', async () => {
    useChatStore.setState({ currentConversationId: 'c1' })
    const snapshots = []
    chatService.streamMessage.mockImplementation((conversationId, content, { onEvent }) => {
      onEvent({ event: 'delta', text: '你好' })
      snapshots.push(useChatStore.getState().messages.map(m => m.content))
      onEvent({ event: 'delta', text: '呀' })
      snapshots.push(useChatStore.getState().messages.map(m => m.content))
      onEvent({ event: 'replace', content: '安全模板全文' })
      snapshots.push(useChatStore.getState().messages.map(m => m.content))
      onEvent({
        event: 'done',
        status: 'ok',
        source: 'local_template',
        userMessage: { id: 'u1', role: 'user', content: '你好' },
        aiMessage: { id: 'a1', role: 'assistant', content: '安全模板全文' },
      })
      return Promise.resolve()
    })

    const result = await useChatStore.getState().sendMessage('你好')

    expect(result).toEqual({ status: 'ok', source: 'local_template' })
    // delta 逐段累积 → replace 整体替换临时文本
    expect(snapshots).toEqual([
      ['你好', '你好'],
      ['你好', '你好呀'],
      ['你好', '安全模板全文'],
    ])
    // done 后临时消息被持久化消息替换
    const messages = useChatStore.getState().messages
    expect(messages).toHaveLength(2)
    expect(messages.map(m => m.id)).toEqual(['u1', 'a1'])
    expect(messages[1]).toMatchObject({ source: 'local_template' })
    expect(useChatStore.getState().isTyping).toBe(false)
  })

  it('keeps the typing indicator until the first delta arrives', async () => {
    useChatStore.setState({ currentConversationId: 'c1' })
    const typingSnapshots = []
    chatService.streamMessage.mockImplementation((conversationId, content, { onEvent }) => {
      typingSnapshots.push(useChatStore.getState().isTyping)
      onEvent({ event: 'delta', text: '第一句' })
      typingSnapshots.push(useChatStore.getState().isTyping)
      onEvent({
        event: 'done',
        status: 'ok',
        userMessage: { id: 'u1', role: 'user', content: '在吗' },
        aiMessage: { id: 'a1', role: 'assistant', content: '第一句' },
      })
      return Promise.resolve()
    })

    await useChatStore.getState().sendMessage('在吗')

    expect(typingSnapshots).toEqual([true, false])
  })

  it('adds one blocked intervention without fabricating an AI response', async () => {
    useChatStore.setState({ currentConversationId: 'c1' })
    chatService.streamMessage.mockImplementation(streamScript([{
      event: 'blocked',
      status: 'blocked',
      userMessage: { id: 'u1', role: 'user', content: '危机输入' },
      intervention: { level: 'high', message: '固定干预文案', resources: [] },
    }]))

    const result = await useChatStore.getState().sendMessage('危机输入')

    expect(result).toEqual({
      status: 'blocked',
      intervention: { level: 'high', message: '固定干预文案', resources: [] },
    })
    expect(useChatStore.getState().messages.map(message => message.content)).toEqual([
      '危机输入',
      '固定干预文案',
    ])
    // 不留临时消息
    expect(useChatStore.getState().messages.every(m => !m.id.startsWith('temp-'))).toBe(true)
  })

  it('removes temporary messages and rethrows the event code on a stream error event', async () => {
    useChatStore.setState({
      currentConversationId: 'c1',
      messages: [{ id: 'existing', role: 'assistant', content: '已有消息' }],
    })
    chatService.streamMessage.mockImplementation(streamScript([
      { event: 'delta', text: '半截回复' },
      { event: 'error', code: 'LLM_UNAVAILABLE' },
    ]))

    let caught
    await useChatStore.getState().sendMessage('需要重试').catch((error) => { caught = error })

    expect(caught.code).toBe('LLM_UNAVAILABLE')
    expect(useChatStore.getState().messages).toEqual([
      { id: 'existing', role: 'assistant', content: '已有消息' },
    ])
    expect(useChatStore.getState().isSending).toBe(false)
    expect(useChatStore.getState().isTyping).toBe(false)
  })

  it('does not append a failed message and resets the sending flag', async () => {
    useChatStore.setState({
      currentConversationId: 'c1',
      messages: [{ id: 'existing', role: 'assistant', content: '已有消息' }],
    })
    chatService.streamMessage.mockRejectedValue(new Error('LLM unavailable'))

    await expect(useChatStore.getState().sendMessage('需要重试')).rejects.toThrow('LLM unavailable')
    expect(useChatStore.getState().messages).toEqual([
      { id: 'existing', role: 'assistant', content: '已有消息' },
    ])
    expect(useChatStore.getState().isSending).toBe(false)
  })

  it('fails with STREAM_FAILED when the stream ends without a terminal event', async () => {
    useChatStore.setState({ currentConversationId: 'c1' })
    chatService.streamMessage.mockImplementation(streamScript([{ event: 'delta', text: '半截' }]))

    let caught
    await useChatStore.getState().sendMessage('断线').catch((error) => { caught = error })

    expect(caught.code).toBe('STREAM_FAILED')
    expect(useChatStore.getState().messages).toEqual([])
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
    chatService.streamMessage.mockImplementation(streamScript([{
      event: 'done',
      status: 'ok',
      userMessage: { id: 'u1', role: 'user', content: '第一条' },
      aiMessage: { id: 'a1', role: 'assistant', content: '回复' },
    }]))

    const result = await useChatStore.getState().sendMessage('第一条')

    expect(chatService.createConversation).toHaveBeenCalled()
    expect(chatService.streamMessage).toHaveBeenCalledWith('c-new', '第一条', expect.objectContaining({
      signal: expect.any(AbortSignal),
      onEvent: expect.any(Function),
    }))
    expect(result.status).toBe('ok')
  })

  it('ignores blank or concurrent sends', async () => {
    useChatStore.setState({ currentConversationId: 'c1' })

    await useChatStore.getState().sendMessage('   ')
    expect(chatService.streamMessage).not.toHaveBeenCalled()

    useChatStore.setState({ isSending: true })
    await useChatStore.getState().sendMessage('并发')
    expect(chatService.streamMessage).not.toHaveBeenCalled()
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

describe('chatStore 会话级模式', () => {
  beforeEach(resetStore)

  it('切换模式时清掉不属于该模式的当前会话与消息', () => {
    useChatStore.setState({
      conversations: [{ id: 'c1', mode: 'chat' }, { id: 'w1', mode: 'work' }],
      currentConversationId: 'c1',
      messages: [{ id: 'm1', role: 'user', content: '聊天记录' }],
    })

    useChatStore.getState().setChatMode('work')

    expect(useChatStore.getState()).toMatchObject({
      chatMode: 'work',
      currentConversationId: null,
      messages: [],
    })
  })

  it('当前会话本就属于目标模式时保留上下文', () => {
    useChatStore.setState({
      conversations: [{ id: 'w1', mode: 'work' }],
      currentConversationId: 'w1',
      messages: [{ id: 'm1', role: 'user', content: '保留' }],
      chatMode: 'chat',
    })

    useChatStore.getState().setChatMode('work')

    expect(useChatStore.getState().currentConversationId).toBe('w1')
    expect(useChatStore.getState().messages).toHaveLength(1)
  })

  it('按当前模式创建会话', async () => {
    chatService.createConversation.mockResolvedValue({ id: 'w2', mode: 'work' })
    useChatStore.getState().setChatMode('work')

    await useChatStore.getState().createConversation()

    expect(chatService.createConversation).toHaveBeenCalledWith('work')
    expect(useChatStore.getState().currentConversationId).toBe('w2')
  })

  it('选中会话时把会话自身的 mode 同步进 chatMode', async () => {
    chatService.getConversation.mockResolvedValue({ id: 'w3', mode: 'work', messages: [] })

    await useChatStore.getState().setCurrentConversation('w3')

    expect(useChatStore.getState().chatMode).toBe('work')
  })

  it('loadConversations 只自动选中当前模式的会话', async () => {
    chatService.getConversations.mockResolvedValue([
      { id: 'w1', mode: 'work', messages: [] },
      { id: 'c1', mode: 'chat', messages: [] },
    ])
    chatService.getConversation.mockResolvedValue({ id: 'c1', mode: 'chat', messages: [] })

    await useChatStore.getState().loadConversations()

    expect(chatService.getConversation).toHaveBeenCalledWith('c1')
    expect(useChatStore.getState().currentConversationId).toBe('c1')
  })

  it('loadConversations 在当前模式无会话时不选中任何会话', async () => {
    chatService.getConversations.mockResolvedValue([{ id: 'w1', mode: 'work', messages: [] }])

    await useChatStore.getState().loadConversations()

    expect(chatService.getConversation).not.toHaveBeenCalled()
    expect(useChatStore.getState().currentConversationId).toBeNull()
  })
})

describe('chatStore stale response guards', () => {
  beforeEach(resetStore)

  it('aborts the in-flight stream and drops late events after the user switched away', async () => {
    const updatedAtBefore = '2026-08-01T00:00:00.000Z'
    useChatStore.setState({
      conversations: [{ id: 'c1', updatedAt: updatedAtBefore }, { id: 'c2', updatedAt: updatedAtBefore }],
      currentConversationId: 'c1',
      messages: [],
    })
    let captured
    chatService.streamMessage.mockImplementation((conversationId, content, options) => new Promise((resolve, reject) => {
      captured = { ...options, resolve }
      options.signal.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted', 'AbortError')))
    }))
    chatService.getConversation.mockResolvedValue({ id: 'c2', messages: [{ id: 'm-c2', content: 'c2 的消息' }] })

    const sendPromise = useChatStore.getState().sendMessage('在 c1 里发的消息')
    // 流未结束时用户切到了 c2
    await useChatStore.getState().setCurrentConversation('c2')
    const result = await sendPromise

    // 旧流被 abort，迟到事件一律丢弃
    expect(captured.signal.aborted).toBe(true)
    captured.onEvent({ event: 'delta', text: '迟到的增量' })
    captured.onEvent({
      event: 'done',
      status: 'ok',
      userMessage: { id: 'u1', role: 'user', content: '在 c1 里发的消息' },
      aiMessage: { id: 'a1', role: 'assistant', content: '迟到的回复' },
    })

    expect(result).toEqual({ status: 'aborted' })
    expect(useChatStore.getState().messages).toEqual([{ id: 'm-c2', content: 'c2 的消息' }])
    // 取消不落库，会话列表不应被迟到流刷新
    expect(useChatStore.getState().conversations[0].updatedAt).toBe(updatedAtBefore)
    expect(useChatStore.getState().isSending).toBe(false)
    expect(useChatStore.getState().isTyping).toBe(false)
  })

  it('does not show a blocked intervention in a conversation the user already left', async () => {
    useChatStore.setState({
      conversations: [{ id: 'c1' }, { id: 'c2' }],
      currentConversationId: 'c1',
      messages: [],
    })
    let captured
    chatService.streamMessage.mockImplementation((conversationId, content, options) => new Promise((resolve) => {
      captured = { ...options, resolve }
    }))

    const sendPromise = useChatStore.getState().sendMessage('危机输入')
    useChatStore.setState({ currentConversationId: 'c2', messages: [{ id: 'm-c2' }] })
    // 直接改 state 不经过 setCurrentConversation：序号未变但归属已变，事件仍须丢弃
    captured.onEvent({
      event: 'blocked',
      status: 'blocked',
      userMessage: { id: 'u1', role: 'user', content: '危机输入' },
      intervention: { level: 'high', message: '干预文案', resources: [] },
    })
    captured.resolve()
    const result = await sendPromise.catch((error) => error)

    expect(useChatStore.getState().messages).toEqual([{ id: 'm-c2' }])
    // 终态事件被丢弃，视为流中断而非阻断
    expect(result.code).toBe('STREAM_FAILED')
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

describe('chatStore 图片消息', () => {
  beforeEach(resetStore)

  it('带 image 发送：空 content 不被守卫拦截，temp 消息带 imagePreviewUrl，blob 传给 streamMessage', async () => {
    useChatStore.setState({ currentConversationId: 'c1' })
    const image = { blob: new Blob(['jpeg'], { type: 'image/jpeg' }), previewUrl: 'blob:preview-1' }
    let tempSnapshot = null
    chatService.streamMessage.mockImplementation((conversationId, content, { onEvent }) => {
      tempSnapshot = useChatStore.getState().messages.find((m) => m.id.startsWith('temp-user-'))
      onEvent({
        event: 'done',
        status: 'ok',
        userMessage: { id: 'u1', role: 'user', content: '', imageExt: '.jpg' },
        aiMessage: { id: 'a1', role: 'assistant', content: '这身好看' },
        source: 'qwen',
      })
      return Promise.resolve()
    })

    const result = await useChatStore.getState().sendMessage('', { image })

    expect(result).toEqual({ status: 'ok', source: 'qwen' })
    expect(tempSnapshot).toMatchObject({ role: 'user', content: '', imagePreviewUrl: 'blob:preview-1' })
    expect(chatService.streamMessage).toHaveBeenCalledWith('c1', '', expect.objectContaining({
      image: image.blob,
    }))
    // settle 后换入持久化消息（带 imageExt），temp 预览消失
    const finalUser = useChatStore.getState().messages.find((m) => m.role === 'user')
    expect(finalUser).toMatchObject({ id: 'u1', imageExt: '.jpg' })
    expect(finalUser.imagePreviewUrl).toBeUndefined()
  })

  it('无 image 且空 content 仍被守卫拦截', async () => {
    useChatStore.setState({ currentConversationId: 'c1' })
    await useChatStore.getState().sendMessage('   ')
    expect(chatService.streamMessage).not.toHaveBeenCalled()
  })
})

