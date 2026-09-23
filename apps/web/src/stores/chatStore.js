import { create } from 'zustand'
import { chatService } from '../services/chatService'
import { onSessionReset } from '../services/sessionLifecycle'

// 只有一段对话：store 只持有这段对话的 id 与已加载的消息（最新一页 + 往上翻出来的更早消息）。
// 迟到流防护：streamSeq 单调递增标记当前流归属，重置/清空/新发送时 abort 旧流并递增序号，旧流事件一律丢弃。
let streamSeq = 0
let activeStreamController = null
let storeVersion = 0
let viewVersion = 0

// 与服务端默认分页一致：一页满了就说明可能还有更早的
const PAGE_SIZE = 50

const stopActiveStream = () => {
  streamSeq += 1
  if (activeStreamController) {
    activeStreamController.abort()
    activeStreamController = null
  }
}

// 流事件处理：delta 累积进临时 AI 气泡，replace 整体替换临时文本，终态事件捕获待收尾。
// 归属失效（序号已变或对话已被重置）后事件一律丢弃。
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
const settleStream = ({ terminalEvent, set, withoutTempMessages }) => {
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
      // offerMemory：她那一轮你说了「帮我记住…」，回复下面的确认卡自动打开
      aiMessage && { ...aiMessage, source, ...(terminalEvent.offerMemory === true ? { offerMemory: true } : {}) },
    ].filter(Boolean),
  }))
  return { status: 'ok', source }
}

// 最新一页与已加载的更早消息合并：保留比最新一页更早的，其余以服务端为准
const mergeLatest = (loaded, latest) => {
  const latestIds = new Set(latest.map((message) => message.id))
  const oldest = latest[0]?.createdAt
  const earlier = oldest ? loaded.filter((message) => !latestIds.has(message.id) && !String(message.id).startsWith('temp-') && message.createdAt < oldest) : []
  return [...earlier, ...latest]
}

export const useChatStore = create(
  (set, get) => ({
    currentConversationId: null,
    messages: [],
    olderPage: 1,
    hasOlder: false,
    loadingOlder: false,
    isTyping: false,
    isSending: false,

    // 打开这段对话（没有就由服务端创建）。发送中不覆盖进行中的临时消息。返回对话 id，失败返回 null。
    loadThread: async () => {
      const session = storeVersion
      const view = viewVersion
      try {
        const thread = await chatService.getThread()
        if (session !== storeVersion) return null
        if (view !== viewVersion || get().isSending) {
          if (!get().currentConversationId) set({ currentConversationId: thread.id })
          return thread.id
        }
        const messages = thread.messages || []
        set({ currentConversationId: thread.id, messages, olderPage: 1, hasOlder: messages.length >= PAGE_SIZE })
        return thread.id
      } catch {
        // 保持可重试的空状态，不向浏览器日志写入请求配置。
        return null
      }
    },

    // 往上翻：取更早的一页，按 id 去重后放在最前面
    loadOlder: async () => {
      const { currentConversationId, olderPage, loadingOlder, hasOlder } = get()
      if (!currentConversationId || loadingOlder || !hasOlder) return
      const session = storeVersion
      set({ loadingOlder: true })
      try {
        const page = await chatService.getThread({ page: olderPage + 1, limit: PAGE_SIZE })
        if (session !== storeVersion) return
        const older = page.messages || []
        set((state) => {
          const known = new Set(state.messages.map((message) => message.id))
          return { messages: [...older.filter((message) => !known.has(message.id)), ...state.messages], olderPage: olderPage + 1, hasOlder: older.length >= PAGE_SIZE }
        })
      } catch {
        // 保持现状，可以再点一次。
      } finally {
        if (session === storeVersion) set({ loadingOlder: false })
      }
    },

    // 后台结果刷新不会取消正在发送的消息，也不会丢掉已经往上翻出来的更早消息。
    refreshThread: async () => {
      if (get().isSending) return
      const view = viewVersion
      const session = storeVersion
      try {
        const thread = await chatService.getThread()
        if (view !== viewVersion || session !== storeVersion || get().isSending) return
        set((state) => ({ currentConversationId: thread.id, messages: mergeLatest(state.messages, thread.messages || []) }))
      } catch { /* 任务结果仍在对话里，下次打开可见。 */ }
    },

    sendMessage: async (content, { image = null, files = [], reading = null } = {}) => {
      if ((content.trim() === '' && !image && !files.length) || get().isSending) return

      // 发送守卫立即生效，并覆盖首次打开对话，避免并发发送
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
          // 还没打开过这段对话：先取回它的 id（发送中不覆盖消息）
          const id = await get().loadThread()
          if (!isCurrentStream()) return { status: 'aborted' }
          if (!id) throw new Error('对话加载失败')
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

        await chatService.streamMessage(targetId, content, { signal: controller.signal, onEvent, image: image?.blob ?? null, files, reading })

        if (!isCurrentStream() || get().currentConversationId !== targetId) {
          // 等待流收尾期间被作废：丢弃结果，不留临时消息
          removeTempMessages()
          return { status: 'aborted' }
        }

        return settleStream({
          terminalEvent: getTerminalEvent(),
          set,
          withoutTempMessages,
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

    // 确认卡处理完一条待确认动作：就地替换那条 toolRun（pending 消失，卡片让位给动作标签）
    patchToolRun: (messageId, index, toolRun) => {
      set((state) => ({
        messages: state.messages.map((message) => (message.id !== messageId || !Array.isArray(message.toolRuns)
          ? message
          : { ...message, toolRuns: message.toolRuns.map((run, runIndex) => (runIndex === index ? toolRun : run)) })),
      }))
    },

    // 清空聊天记录：服务端删掉这段对话里的全部消息；她记得的你和她的状态不受影响
    clearThread: async () => {
      const session = storeVersion
      await chatService.clearThread()
      if (session !== storeVersion) return
      stopActiveStream()
      viewVersion += 1
      set({ messages: [], olderPage: 1, hasOlder: false, isSending: false, isTyping: false })
    },

    reset: () => {
      stopActiveStream()
      storeVersion += 1
      viewVersion += 1
      set({
        currentConversationId: null,
        messages: [],
        olderPage: 1,
        hasOlder: false,
        loadingOlder: false,
        isTyping: false,
        isSending: false,
      })
    },
  })
)

onSessionReset(() => useChatStore.getState().reset())
