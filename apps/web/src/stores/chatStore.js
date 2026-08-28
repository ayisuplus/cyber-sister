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
          set({
            currentConversationId: conversations[0].id,
            messages: conversations[0].messages || [],
          })
        }
      } catch (error) {
        console.error('加载会话列表失败:', error)
      }
    },

    createConversation: async () => {
      try {
        const conversation = await chatService.createConversation()
        set((state) => ({
          conversations: [conversation, ...state.conversations],
          currentConversationId: conversation.id,
          messages: [],
        }))
        return conversation
      } catch (error) {
        console.error('创建会话失败:', error)
        throw error
      }
    },

    setCurrentConversation: async (id) => {
      set({ currentConversationId: id })

      try {
        const conversation = await chatService.getConversation(id)
        set({ messages: conversation.messages || [] })
      } catch (error) {
        console.error('加载会话详情失败:', error)
      }
    },

    sendMessage: async (content, persona = 'toxic') => {
      if (!content.trim() || get().isSending) return

      const { currentConversationId } = get()
      if (!currentConversationId) {
        // 创建新会话
        await get().createConversation()
      }

      set({ isSending: true })

      try {
        const response = await chatService.sendMessage(
          get().currentConversationId,
          content
        )

        const { userMessage, aiMessage, crisisLevel } = response

        if (crisisLevel) {
          set({ isSending: false })
          return { crisisLevel }
        }

        set((state) => ({
          messages: [...state.messages, userMessage, aiMessage].filter(Boolean),
          isSending: false,
        }))

        // 更新会话列表
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === state.currentConversationId
              ? { ...c, updatedAt: new Date().toISOString() }
              : c
          ),
        }))

        return { emotion: aiMessage?.emotion }
      } catch (error) {
        set({ isSending: false })
        console.error('发送消息失败:', error)
        throw error
      }
    },

    deleteConversation: async (id) => {
      try {
        await chatService.deleteConversation(id)

        set((state) => {
          const conversations = state.conversations.filter((c) => c.id !== id)
          const newCurrentId =
            state.currentConversationId === id
              ? conversations[0]?.id || null
              : state.currentConversationId

          return {
            conversations,
            currentConversationId: newCurrentId,
            messages: newCurrentId ? state.messages : [],
          }
        })
      } catch (error) {
        console.error('删除会话失败:', error)
        throw error
      }
    },

    clearMessages: () => set({ messages: [] }),
  })
)
