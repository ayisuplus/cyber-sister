import { create } from 'zustand'
import { chatService } from '../services/chatService'
import { onSessionReset } from '../services/sessionLifecycle'
import { isLocalWorkClient } from '../features/distribution'

// 迟到流防护：streamSeq 单调递增标记当前流归属，
// 切换会话/重置/新发送时 abort 旧流并递增序号，旧流事件一律丢弃。
let streamSeq = 0
let activeStreamController = null
let storeVersion = 0
let viewVersion = 0
let listVersion = 0

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
    if (terminalEvent || !isCurrentStream() || get().currentConversationId !== targetId) return
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
    } else if (event?.event === 'tool_progress' && Number.isInteger(event.step)) {
      set((state) => ({
        isTyping: false,
        messages: state.messages.map((message) => message.id === tempAiId ? {
          ...message,
          progress: [...(message.progress || []).filter((step) => step.step !== event.step), event],
        } : message),
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
    archiveRevision: 0,
    currentConversationId: null,
    messages: [],
    isTyping: false,
    isSending: false,

    loadConversations: async () => {
      const session = storeVersion
      const list = ++listVersion
      const view = viewVersion
      try {
        const conversations = await chatService.getConversations()
        if (session !== storeVersion || list !== listVersion) return
        // 只有一种对话；旧的工作会话在网页版仍不显示（后端同样过滤）
        set({ conversations: isLocalWorkClient() ? conversations : conversations.filter(c => c.mode !== 'work') })

        if (view === viewVersion && conversations.length > 0 && !get().currentConversationId) {
          const first = get().conversations.find((c) => !c.archivedAt)
          if (!first) return
          await get().setCurrentConversation(first.id)
        }
      } catch {
        // 页面保持可重试的空状态，不向浏览器日志写入请求配置。
      }
    },

    createConversation: async () => {
      stopActiveStream()
      const session = storeVersion
      const view = ++viewVersion
      listVersion += 1
      set({ isSending: false, isTyping: false })
      const conversation = await chatService.createConversation()
      if (session !== storeVersion || view !== viewVersion) return null
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
      const view = ++viewVersion
      set({ currentConversationId: id, messages: [], isTyping: false, isSending: false })

      try {
        const conversation = await chatService.getConversation(id)
          // 响应回来时若已切换到其它会话，丢弃这条过期数据
          if (view !== viewVersion || get().currentConversationId !== id) return
          if (!isLocalWorkClient() && conversation.mode === 'work') {
            set({ currentConversationId: null, messages: [] })
            return
          }
        set({ messages: conversation.messages || [] })
      } catch {
        // 保持该会话的空状态，不把其它会话消息展示为当前记录。
      }
    },

    // 后台结果刷新不会取消正在发送的消息，也不会把旧会话响应写进新页面。
    refreshConversation: async (id) => {
      if (get().currentConversationId !== id || get().isSending) return
      const view = viewVersion
      const session = storeVersion
      try {
        const conversation = await chatService.getConversation(id)
        if (!isLocalWorkClient() && conversation.mode === 'work') return
        if (view !== viewVersion || session !== storeVersion || get().currentConversationId !== id || get().isSending) return
        set({ messages: conversation.messages || [] })
      } catch { /* Task results remain available through the conversation history. */ }
    },

    sendMessage: async (content, { image = null, files = [] } = {}) => {
      if ((content.trim() === '' && !image && !files.length) || get().isSending) return

      // 发送守卫立即生效，并覆盖会话创建，避免并发发送/并发建会话
      set({ isSending: true })
      // 新发送作废旧流（abort + 序号失效）
      stopActiveStream()
      viewVersion += 1
      const streamId = streamSeq
      const controller = new AbortController()
      activeStreamController = controller

      // 临时消息：流进行中渲染用，done 用持久化消息替换，blocked/失败时移除
      const tempUserId = `temp-user-${streamId}`
      const tempAiId = `temp-ai-${streamId}`
      const withoutTempMessages = (messages) =>
        messages.filter((message) => message.id !== tempUserId && message.id !== tempAiId)
      const removeTempMessages = () =>
        set((state) => ({
          messages: withoutTempMessages(state.messages),
          ...(isCurrentStream() ? { isTyping: false } : {}),
        }))
      const isCurrentStream = () => streamSeq === streamId && !controller.signal.aborted

      try {
        if (!get().currentConversationId) {
          // 自动创建属于当前发送；公开的新建操作会取消流，因此在这里直接创建。
          listVersion += 1
          const conversation = await chatService.createConversation()
          if (!isCurrentStream()) return { status: 'aborted' }
          set((state) => ({
            conversations: [conversation, ...state.conversations],
            currentConversationId: conversation.id,
            messages: [],
          }))
        }
        const targetId = get().currentConversationId

        // isTyping 语义保持兼容：首个 delta/replace 之前驱动 TypingIndicator，
        // 之后由临时 AI 气泡承担流式进行中的视觉
        set((state) => ({
          messages: [
            ...state.messages,
            { id: tempUserId, role: 'user', content, imagePreviewUrl: image?.previewUrl ?? null, pendingFiles: files.map((file) => file.name), createdAt: new Date().toISOString() },
            { id: tempAiId, role: 'assistant', content: '', streaming: true },
          ],
          isTyping: true,
        }))

        const { onEvent, getTerminalEvent } = createStreamEventHandler({
          set, get, tempAiId, isCurrentStream, targetId,
        })

        await chatService.streamMessage(targetId, content, { signal: controller.signal, onEvent, image: image?.blob ?? null, files })

        if (!isCurrentStream() || get().currentConversationId !== targetId) {
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
      } catch (error) {
        removeTempMessages()
        if (!isCurrentStream()) return { status: 'aborted' }
        throw error
      } finally {
        if (activeStreamController === controller) {
          activeStreamController = null
          set({ isSending: false })
        }
      }
    },

    archiveConversation: async (id) => {
      const session = storeVersion
      await chatService.setArchived(id, true)
      if (session !== storeVersion) return
      listVersion += 1
      set((state) => ({ conversations: state.conversations.filter((c) => c.id !== id), archiveRevision: state.archiveRevision + 1 }))
      if (get().currentConversationId === id) {
        stopActiveStream()
        viewVersion += 1
        set({ currentConversationId: null, messages: [], isSending: false, isTyping: false })
        const next = get().conversations.find((c) => !c.archivedAt)
        if (next) await get().setCurrentConversation(next.id)
      }
    },

    deleteConversation: async (id) => {
      const session = storeVersion
      await chatService.deleteConversation(id)
      if (session !== storeVersion) return
      listVersion += 1

      const deletingCurrent = get().currentConversationId === id
      const nextConversationId = deletingCurrent
        ? get().conversations.find((conversation) => conversation.id !== id && !conversation.archivedAt)?.id || null
        : get().currentConversationId
      set((state) => {
        const conversations = state.conversations.filter((c) => c.id !== id)

        return {
          conversations,
          currentConversationId: nextConversationId,
          messages: deletingCurrent ? [] : state.messages,
        }
      })
      if (deletingCurrent) {
        stopActiveStream()
        viewVersion += 1
        set({ isSending: false, isTyping: false })
      }
      if (deletingCurrent && nextConversationId) {
        await get().setCurrentConversation(nextConversationId)
      }
    },

    clearMessages: () => {
      stopActiveStream()
      viewVersion += 1
      set({ messages: [], isSending: false, isTyping: false })
    },
    reset: () => {
      stopActiveStream()
      storeVersion += 1
      viewVersion += 1
      listVersion += 1
      set({
        conversations: [],
        archiveRevision: 0,
        currentConversationId: null,
        messages: [],
        isTyping: false,
        isSending: false,
      })
    },
  })
)

onSessionReset(() => useChatStore.getState().reset())
