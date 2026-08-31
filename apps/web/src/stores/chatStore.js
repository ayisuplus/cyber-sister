import { create } from 'zustand'
import { chatService } from '../services/chatService'

export const useChatStore = create(
  (set, get) => ({
    conversations: [],
    currentConversationId: null,
    messages: [],
    isTyping: false,
    isSending: false,

    loadConversations: async () => {
      try {
        const conversations = await chatService.getConversations()
        set({ conversations })

        if (conversations.length > 0 && !get().currentConversationId) {
          const currentConversationId = conversations[0].id
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
      const conversation = await chatService.createConversation()
      set((state) => ({
        conversations: [conversation, ...state.conversations],
        currentConversationId: conversation.id,
        messages: [],
      }))
      return conversation
    },

    setCurrentConversation: async (id) => {
      set({ currentConversationId: id })

      try {
        const conversation = await chatService.getConversation(id)
        // 响应回来时若已切换到其它会话，丢弃这条过期数据
        if (get().currentConversationId !== id) return
        set({ messages: conversation.messages || [] })
      } catch {
        // 保留当前消息，避免把可能含 Authorization 的错误对象写入日志。
      }
    },

    sendMessage: async (content) => {
      if (!content.trim() || get().isSending) return

      // 发送守卫立即生效，并覆盖会话创建，避免并发发送/并发建会话
      set({ isSending: true })

      try {
        if (!get().currentConversationId) {
          // 创建新会话
          await get().createConversation()
        }
        const targetId = get().currentConversationId

        const response = await chatService.sendMessage(targetId, content)

        const { userMessage, aiMessage, intervention, status } = response

        // 等待响应期间用户可能已切换会话：此时只刷新会话列表，
        // 不把迟到的消息追加到另一个会话的消息视图里。
        const stillCurrent = get().currentConversationId === targetId

        if (status === 'blocked') {
          const interventionMessage = intervention?.message
            ? {
                id: `intervention-${userMessage?.id || Date.now()}`,
                role: 'assistant',
                content: intervention.message,
                createdAt: new Date().toISOString(),
              }
            : null
          if (stillCurrent) {
            set((state) => ({
              messages: [...state.messages, userMessage, interventionMessage].filter(Boolean),
            }))
          }
          return { status, intervention }
        }

        if (stillCurrent) {
          set((state) => ({
            messages: [...state.messages, userMessage, aiMessage && { ...aiMessage, source: response.source }].filter(Boolean),
          }))
        }

        // 更新会话列表
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === targetId
              ? { ...c, updatedAt: new Date().toISOString() }
              : c
          ),
        }))

        return { status: status || 'ok', source: response.source }
      } finally {
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
    reset: () => set({
      conversations: [],
      currentConversationId: null,
      messages: [],
      isTyping: false,
      isSending: false,
    }),
  })
)
