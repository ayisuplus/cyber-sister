import { create } from 'zustand'
import { chatService } from '../services/chatService'

// 迟到流防护：streamSeq 单调递增标记当前流归属，
// 切换会话/重置/新发送时 abort 旧流并递增序号，旧流事件一律丢弃。
let streamSeq = 0
let activeStreamController = null

const stopActiveStream = () => {
  streamSeq += 1
  if (activeStreamController) {
    activeStreamController.abort()
    activeStreamController = null
  }
}

// 流事件处理：delta 累积进临时 AI 气泡，replace 整体替换临时文本，终态事件捕获待收尾。
// 归属失效（序号已变或已切走会话）后事件一律丢弃。
const createStreamEventHandler = ({ set, get, tempAiId, isCurrentStream, targetId }) => {
  /** @type {any} */
  let terminalEvent = null

  const onEvent = (event) => {
    if (!isCurrentStream() || get().currentConversationId !== targetId) return
    if (event?.event === 'delta' && typeof event.text === 'string') {
      set((state) => ({
        isTyping: false,
        messages: state.messages.map((message) =>
          message.id === tempAiId
            ? { ...message, content: message.content + event.text }
            : message
        ),
      }))
    } else if (event?.event === 'replace' && typeof event.content === 'string') {
      // 安全过滤命中：整体替换此前已渲染的临时 AI 文本
      set((state) => ({
        isTyping: false,
        messages: state.messages.map((message) =>
          message.id === tempAiId ? { ...message, content: event.content } : message
        ),
      }))
    } else if (event?.event === 'done' || event?.event === 'blocked' || event?.event === 'error') {
      terminalEvent = event
    }
  }

  return { onEvent, getTerminalEvent: () => terminalEvent }
}

// 流收尾：done 用已落库的持久化消息替换临时消息；blocked 写入持久化用户消息与干预文案；
// error / 无终态事件（断线、服务端中途失败不落库）移除临时消息并抛带 code 的错误。
const settleStream = ({ terminalEvent, set, withoutTempMessages, targetId }) => {
  const dropTempMessages = () =>
    set((state) => ({ messages: withoutTempMessages(state.messages), isTyping: false }))

  if (!terminalEvent) {
    dropTempMessages()
    /** @type {Error & { code?: string }} */
    const error = new Error('流式响应中断')
    error.code = 'STREAM_FAILED'
    throw error
  }

  if (terminalEvent.event === 'error') {
    dropTempMessages()
    /** @type {Error & { code?: string }} */
    const error = new Error('流式生成失败')
    if (terminalEvent.code) error.code = terminalEvent.code
    throw error
  }

  if (terminalEvent.event === 'blocked') {
    const { userMessage, intervention } = terminalEvent
    // 沿用 JSON 端点语义：干预文案消息驱动现有 CrisisModal
    const interventionMessage = intervention?.message
      ? {
          id: `intervention-${userMessage?.id || Date.now()}`,
          role: 'assistant',
          content: intervention.message,
          createdAt: new Date().toISOString(),
        }
      : null
    set((state) => ({
      isTyping: false,
      messages: [
        ...withoutTempMessages(state.messages),
        userMessage,
        interventionMessage,
      ].filter(Boolean),
    }))
    return { status: 'blocked', intervention }
  }

  // done：用持久化消息替换临时消息
  const { userMessage, aiMessage, source } = terminalEvent
  set((state) => ({
    isTyping: false,
    messages: [
      ...withoutTempMessages(state.messages),
      userMessage,
      aiMessage && { ...aiMessage, source },
    ].filter(Boolean),
    conversations: state.conversations.map((c) =>
      c.id === targetId
        ? { ...c, updatedAt: new Date().toISOString() }
        : c
    ),
  }))
  return { status: 'ok', source }
}

export const useChatStore = create(
  (set, get) => ({
    conversations: [],
    currentConversationId: null,
    messages: [],
    // 会话级模式归属：chat | work；会话列表按当前模式过滤，新建会话落在当前模式
    chatMode: 'chat',
    setChatMode: (mode) => {
      if (!['chat', 'work'].includes(mode) || mode === get().chatMode) return
      stopActiveStream()
      const current = get().conversations.find((c) => c.id === get().currentConversationId)
      const belongs = current && (current.mode || 'chat') === mode
      set({
        chatMode: mode,
        isTyping: false,
        ...(belongs ? {} : { currentConversationId: null, messages: [] }),
      })
    },

    loadConversations: async () => {
      try {
        const conversations = await chatService.getConversations()
        set({ conversations })

        if (conversations.length > 0 && !get().currentConversationId) {
          const first = conversations.find((c) => (c.mode || 'chat') === get().chatMode)
          if (!first) return
          const currentConversationId = first.id
          set({ currentConversationId })
          const conversation = await chatService.getConversation(currentConversationId)
          // 等待期间用户可能已切换会话，乱序响应不得覆盖当前视图
          if (get().currentConversationId !== currentConversationId) return
          set({ messages: conversation.messages || [] })
        }
      } catch {
        // 页面保持可重试的空状态，不向浏览器日志写入请求配置。
      }
    },

    createConversation: async () => {
      const conversation = await chatService.createConversation(get().chatMode)
      set((state) => ({
        conversations: [conversation, ...state.conversations],
        currentConversationId: conversation.id,
        messages: [],
      }))
      return conversation
    },

    setCurrentConversation: async (id) => {
      // 作废旧流：进行中的流被取消，迟到事件因序号失效被丢弃
      stopActiveStream()
      set({ currentConversationId: id, isTyping: false })

      try {
        const conversation = await chatService.getConversation(id)
        // 响应回来时若已切换到其它会话，丢弃这条过期数据
        if (get().currentConversationId !== id) return
        set({ messages: conversation.messages || [], chatMode: conversation.mode || 'chat' })
      } catch {
        // 保留当前消息，避免把可能含 Authorization 的错误对象写入日志。
      }
    },

    sendMessage: async (content) => {
      if (!content.trim() || get().isSending) return

      // 发送守卫立即生效，并覆盖会话创建，避免并发发送/并发建会话
      set({ isSending: true })
      // 新发送作废旧流（abort + 序号失效）
      stopActiveStream()
      const streamId = streamSeq
      const controller = new AbortController()
      activeStreamController = controller

      // 临时消息：流进行中渲染用，done 用持久化消息替换，blocked/失败时移除
      const tempUserId = `temp-user-${streamId}`
      const tempAiId = `temp-ai-${streamId}`
      const withoutTempMessages = (messages) =>
        messages.filter((message) => message.id !== tempUserId && message.id !== tempAiId)
      const removeTempMessages = () =>
        set((state) => ({ messages: withoutTempMessages(state.messages), isTyping: false }))
      const isCurrentStream = () => streamSeq === streamId

      try {
        if (!get().currentConversationId) {
          // 创建新会话
          await get().createConversation()
        }
        const targetId = get().currentConversationId

        // isTyping 语义保持兼容：首个 delta/replace 之前驱动 TypingIndicator，
        // 之后由临时 AI 气泡承担流式进行中的视觉
        set((state) => ({
          messages: [
            ...state.messages,
            { id: tempUserId, role: 'user', content, createdAt: new Date().toISOString() },
            { id: tempAiId, role: 'assistant', content: '', streaming: true },
          ],
          isTyping: true,
        }))

        const { onEvent, getTerminalEvent } = createStreamEventHandler({
          set, get, tempAiId, isCurrentStream, targetId,
        })

        let streamFailure = null
        try {
          await chatService.streamMessage(targetId, content, { signal: controller.signal, onEvent })
        } catch (streamError) {
          streamFailure = streamError
        }

        if (streamFailure) {
          removeTempMessages()
          if (!isCurrentStream() || controller.signal.aborted) {
            // 切换会话/重置/新发送作废了这条流：静默结束，不当作发送失败展示
            return { status: 'aborted' }
          }
          throw streamFailure
        }

        if (!isCurrentStream()) {
          // 等待流收尾期间被作废：丢弃结果，不留临时消息
          removeTempMessages()
          return { status: 'aborted' }
        }

        return settleStream({
          terminalEvent: getTerminalEvent(),
          set,
          withoutTempMessages,
          targetId,
        })
      } finally {
        if (activeStreamController === controller) activeStreamController = null
        set({ isSending: false })
      }
    },

    deleteConversation: async (id) => {
      await chatService.deleteConversation(id)

      const deletingCurrent = get().currentConversationId === id
      const nextConversationId = deletingCurrent
        ? get().conversations.find((conversation) => conversation.id !== id)?.id || null
        : get().currentConversationId
      set((state) => {
        const conversations = state.conversations.filter((c) => c.id !== id)

        return {
          conversations,
          currentConversationId: nextConversationId,
          messages: deletingCurrent ? [] : state.messages,
        }
      })
      if (deletingCurrent && nextConversationId) {
        await get().setCurrentConversation(nextConversationId)
      }
    },

    clearMessages: () => set({ messages: [] }),
    reset: () => {
      stopActiveStream()
      set({
        conversations: [],
        currentConversationId: null,
        messages: [],
        isTyping: false,
        isSending: false,
      })
    },
  })
)
