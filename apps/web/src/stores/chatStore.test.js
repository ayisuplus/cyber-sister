import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/chatService', () => ({
  chatService: {
    getConversations: vi.fn(),
    getConversation: vi.fn(),
    getThread: vi.fn(),
    clearThread: vi.fn(),
    streamMessage: vi.fn(),
    setArchived: vi.fn(),
  },
}))

import { chatService } from '../services/chatService'
import { useChatStore } from './chatStore'

const resetStore = () => {
  vi.clearAllMocks()
  useChatStore.getState().reset()
}

// 让 streamMessage 按脚本逐事件回调后 resolve
const streamScript = (events) => (conversationId, content, { onEvent }) => {
  for (const event of events) onEvent(event)
  return Promise.resolve()
}

const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

const page = (count, from = 0) => Array.from({ length: count }, (_, index) => ({
  id: `m${from + index}`, role: 'user', content: `第${from + index}条`, createdAt: new Date(Date.UTC(2026, 8, 1, 0, from + index)).toISOString(),
}))

describe('chatStore 只有一段对话', () => {
  beforeEach(resetStore)

  it('has no conversation list, creation, switching or archiving', () => {
    const state = useChatStore.getState()
    for (const key of ['conversations', 'createConversation', 'setCurrentConversation', 'archiveConversation', 'deleteConversation', 'loadConversations']) {
      expect(state).not.toHaveProperty(key)
    }
  })

  it('opens the one thread with its latest page and knows whether older messages exist', async () => {
    chatService.getThread.mockResolvedValueOnce({ id: 't1', messages: page(3) })
    expect(await useChatStore.getState().loadThread()).toBe('t1')
    expect(useChatStore.getState()).toMatchObject({ currentConversationId: 't1', messages: page(3), hasOlder: false })
    expect(chatService.getThread).toHaveBeenCalledWith()

    chatService.getThread.mockResolvedValueOnce({ id: 't1', messages: page(50) })
    await useChatStore.getState().loadThread()
    expect(useChatStore.getState().hasOlder).toBe(true)
  })

  it('keeps the empty state when the thread fails to load', async () => {
    chatService.getThread.mockRejectedValue(new Error('offline'))

    expect(await useChatStore.getState().loadThread()).toBeNull()
    expect(useChatStore.getState()).toMatchObject({ currentConversationId: null, messages: [] })
  })

  it('loads older pages above the current ones without duplicates and stops at a short page', async () => {
    useChatStore.setState({ currentConversationId: 't1', messages: page(50, 50), hasOlder: true, olderPage: 1 })
    chatService.getThread.mockResolvedValueOnce({ id: 't1', messages: [...page(49, 1), page(1, 50)[0]] })

    await useChatStore.getState().loadOlder()

    expect(chatService.getThread).toHaveBeenCalledWith({ page: 2, limit: 50 })
    const ids = useChatStore.getState().messages.map((message) => message.id)
    expect(ids).toHaveLength(99)
    expect(new Set(ids).size).toBe(99)
    expect(ids[0]).toBe('m1')
    expect(useChatStore.getState()).toMatchObject({ olderPage: 2, hasOlder: true, loadingOlder: false })

    chatService.getThread.mockResolvedValueOnce({ id: 't1', messages: [page(1, 0)[0]] })
    await useChatStore.getState().loadOlder()
    expect(useChatStore.getState().messages[0].id).toBe('m0')
    expect(useChatStore.getState().hasOlder).toBe(false)
    chatService.getThread.mockClear()
    await useChatStore.getState().loadOlder()
    expect(chatService.getThread).not.toHaveBeenCalled()
  })

  it('opens the thread on the fly when sending before it loaded', async () => {
    chatService.getThread.mockResolvedValue({ id: 't-new', messages: [] })
    chatService.streamMessage.mockImplementation(streamScript([{
      event: 'done',
      status: 'ok',
      userMessage: { id: 'u1', role: 'user', content: '第一条' },
      aiMessage: { id: 'a1', role: 'assistant', content: '回复' },
    }]))

    const result = await useChatStore.getState().sendMessage('第一条')

    expect(chatService.streamMessage).toHaveBeenCalledWith('t-new', '第一条', expect.objectContaining({
      signal: expect.any(AbortSignal),
      onEvent: expect.any(Function),
    }))
    expect(result.status).toBe('ok')
    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual(['u1', 'a1'])
  })

  it('does not send when the thread cannot be opened, and keeps no temporary messages', async () => {
    chatService.getThread.mockRejectedValue(new Error('offline'))

    await expect(useChatStore.getState().sendMessage('第一条')).rejects.toThrow('对话加载失败')
    expect(chatService.streamMessage).not.toHaveBeenCalled()
    expect(useChatStore.getState()).toMatchObject({ messages: [], isSending: false })
  })

  it('ignores blank or concurrent sends', async () => {
    useChatStore.setState({ currentConversationId: 't1' })

    await useChatStore.getState().sendMessage('   ')
    expect(chatService.streamMessage).not.toHaveBeenCalled()

    useChatStore.setState({ isSending: true })
    await useChatStore.getState().sendMessage('并发')
    expect(chatService.streamMessage).not.toHaveBeenCalled()
  })

  it('clears the history only after the server confirms', async () => {
    useChatStore.setState({ currentConversationId: 't1', messages: page(2), hasOlder: true, olderPage: 3 })
    chatService.clearThread.mockRejectedValueOnce(new Error('offline'))
    await expect(useChatStore.getState().clearThread()).rejects.toThrow('offline')
    expect(useChatStore.getState().messages).toEqual(page(2))

    chatService.clearThread.mockResolvedValueOnce({ success: true })
    await useChatStore.getState().clearThread()
    expect(useChatStore.getState()).toMatchObject({ currentConversationId: 't1', messages: [], hasOlder: false, olderPage: 1 })
  })

  it('resets the whole store', () => {
    useChatStore.setState({ currentConversationId: 't1', messages: page(1), isTyping: true, hasOlder: true })

    useChatStore.getState().reset()

    expect(useChatStore.getState()).toMatchObject({
      currentConversationId: null,
      messages: [],
      hasOlder: false,
      isTyping: false,
      isSending: false,
    })
  })
})

describe('chatStore lifecycle ownership', () => {
  beforeEach(resetStore)

  it('后台结果刷新保留往上翻出的更早消息，不覆盖重置后的状态，也不打断在途消息', async () => {
    const [older, kept, latest] = page(3)
    useChatStore.setState({ currentConversationId: 't1', messages: [older, kept] })
    chatService.getThread.mockResolvedValueOnce({ id: 't1', messages: [kept, latest] })
    await useChatStore.getState().refreshThread()
    expect(useChatStore.getState().messages).toEqual([older, kept, latest])

    const response = deferred()
    chatService.getThread.mockReturnValueOnce(response.promise)
    const refreshing = useChatStore.getState().refreshThread()
    useChatStore.getState().reset()
    useChatStore.setState({ currentConversationId: 't2', messages: [{ id: 'new' }] })
    response.resolve({ id: 't1', messages: [{ id: 'late' }] })
    await refreshing
    expect(useChatStore.getState().messages).toEqual([{ id: 'new' }])

    chatService.getThread.mockClear()
    useChatStore.setState({ isSending: true })
    await useChatStore.getState().refreshThread()
    expect(chatService.getThread).not.toHaveBeenCalled()
  })

  it('工作工具进度在空白回复中可见，终态后的迟到工具和内容不再污染回复', async () => {
    useChatStore.setState({ currentConversationId: 't1' })
    chatService.streamMessage.mockImplementation(async (_id, _text, { onEvent }) => {
      onEvent({ event: 'tool_progress', step: 0, tool: 'create_artifact', status: 'running' })
      expect(useChatStore.getState().messages.at(-1).progress[0].status).toBe('running')
      expect(useChatStore.getState().isTyping).toBe(false)
      onEvent({ event: 'done', userMessage: { id: 'u1', role: 'user', content: '报告' }, aiMessage: { id: 'a1', role: 'assistant', content: '完成' } })
      onEvent({ event: 'tool_progress', step: 1, tool: 'web_search', status: 'running' })
      onEvent({ event: 'delta', text: 'late' })
      expect(useChatStore.getState().messages.at(-1).content).toBe('')
      expect(useChatStore.getState().messages.at(-1).progress).toHaveLength(1)
    })
    await useChatStore.getState().sendMessage('报告')
    expect(useChatStore.getState().messages.at(-1).content).toBe('完成')
  })

  it('「帮我记住」那一轮：回复带上 offerMemory，好让确认卡自动打开', async () => {
    useChatStore.setState({ currentConversationId: 't1' })
    chatService.streamMessage.mockImplementation(async (_id, _text, { onEvent }) => {
      onEvent({ event: 'done', offerMemory: true, userMessage: { id: 'u1', role: 'user', content: '帮我记住我对芒果过敏' }, aiMessage: { id: 'a1', role: 'assistant', content: '好，在下面确认一下' } })
    })

    await useChatStore.getState().sendMessage('帮我记住我对芒果过敏')

    expect(useChatStore.getState().messages.at(-1)).toMatchObject({ id: 'a1', offerMemory: true })
  })

  it('平常的回复不带 offerMemory', async () => {
    useChatStore.setState({ currentConversationId: 't1' })
    chatService.streamMessage.mockImplementation(async (_id, _text, { onEvent }) => {
      onEvent({ event: 'done', offerMemory: false, userMessage: { id: 'u2', role: 'user', content: '在吗' }, aiMessage: { id: 'a2', role: 'assistant', content: '在' } })
    })

    await useChatStore.getState().sendMessage('在吗')

    expect(useChatStore.getState().messages.at(-1)).not.toHaveProperty('offerMemory')
  })

  it('does not restore a previous account thread after reset', async () => {
    const thread = deferred()
    chatService.getThread.mockReturnValue(thread.promise)
    const pending = useChatStore.getState().loadThread()
    useChatStore.getState().reset()
    thread.resolve({ id: 'old-account', messages: [{ id: 'old-private' }] })
    expect(await pending).toBeNull()
    expect(useChatStore.getState()).toMatchObject({ currentConversationId: null, messages: [] })
  })

  it('does not send into a thread that finished opening after reset', async () => {
    const thread = deferred()
    chatService.getThread.mockReturnValue(thread.promise)
    chatService.streamMessage.mockResolvedValue()
    const pending = useChatStore.getState().sendMessage('previous account draft')
    useChatStore.getState().reset()
    thread.resolve({ id: 'old-thread', messages: [] })
    await expect(pending).resolves.toEqual({ status: 'aborted' })
    expect(useChatStore.getState().currentConversationId).toBeNull()
    expect(chatService.streamMessage).not.toHaveBeenCalled()
  })

  it('keeps a new stream busy when an aborted older stream settles late', async () => {
    const old = deferred()
    const current = deferred()
    chatService.streamMessage.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    useChatStore.setState({ currentConversationId: 'old' })
    const oldSend = useChatStore.getState().sendMessage('old')
    useChatStore.getState().reset()
    useChatStore.setState({ currentConversationId: 'new' })
    const newSend = useChatStore.getState().sendMessage('new')
    old.resolve()
    await oldSend
    expect(useChatStore.getState()).toMatchObject({ isSending: true, isTyping: true })
    useChatStore.getState().reset()
    current.resolve()
    await newSend
  })

  it('a thread fetch that returns during a send never overwrites the temporary messages', async () => {
    const thread = deferred()
    chatService.getThread.mockReturnValueOnce(thread.promise)
    const loading = useChatStore.getState().loadThread()
    useChatStore.setState({ isSending: true, messages: [{ id: 'temp-user-1' }] })
    thread.resolve({ id: 't1', messages: [{ id: 'server' }] })
    expect(await loading).toBe('t1')
    expect(useChatStore.getState()).toMatchObject({ currentConversationId: 't1', messages: [{ id: 'temp-user-1' }] })
  })
})

describe('chatStore', () => {
  beforeEach(resetStore)

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

describe('chatStore stale response guards', () => {
  beforeEach(resetStore)

  it('aborts the in-flight stream and drops late events after the user cleared the history', async () => {
    useChatStore.setState({ currentConversationId: 't1', messages: [] })
    let captured
    chatService.streamMessage.mockImplementation((conversationId, content, options) => new Promise((resolve, reject) => {
      captured = { ...options, resolve }
      options.signal.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted', 'AbortError')))
    }))
    chatService.clearThread.mockResolvedValue({ success: true })

    const sendPromise = useChatStore.getState().sendMessage('清空前发的消息')
    await useChatStore.getState().clearThread()
    const result = await sendPromise

    // 旧流被 abort，迟到事件一律丢弃
    expect(captured.signal.aborted).toBe(true)
    captured.onEvent({ event: 'delta', text: '迟到的增量' })
    captured.onEvent({
      event: 'done',
      status: 'ok',
      userMessage: { id: 'u1', role: 'user', content: '清空前发的消息' },
      aiMessage: { id: 'a1', role: 'assistant', content: '迟到的回复' },
    })

    expect(result).toEqual({ status: 'aborted' })
    expect(useChatStore.getState().messages).toEqual([])
    expect(useChatStore.getState().isSending).toBe(false)
    expect(useChatStore.getState().isTyping).toBe(false)
  })

  it('does not show a blocked intervention in a thread that is no longer current', async () => {
    useChatStore.setState({ currentConversationId: 't1', messages: [] })
    let captured
    chatService.streamMessage.mockImplementation((conversationId, content, options) => new Promise((resolve) => {
      captured = { ...options, resolve }
    }))

    const sendPromise = useChatStore.getState().sendMessage('危机输入')
    useChatStore.setState({ currentConversationId: 't2', messages: [{ id: 'm-t2' }] })
    // 直接改 state：序号未变但归属已变，事件仍须丢弃
    captured.onEvent({
      event: 'blocked',
      status: 'blocked',
      userMessage: { id: 'u1', role: 'user', content: '危机输入' },
      intervention: { level: 'high', message: '干预文案', resources: [] },
    })
    captured.resolve()
    const result = await sendPromise.catch((error) => error)

    expect(useChatStore.getState().messages).toEqual([{ id: 'm-t2' }])
    expect(result).toEqual({ status: 'aborted' })
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
