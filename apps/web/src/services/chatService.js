import api from './api'

export const chatService = {
  getConversations: async () => {
    const response = await api.get('/chat/conversations')
    return response.data
  },

  createConversation: async () => {
    const response = await api.post('/chat/conversations')
    return response.data
  },

  getConversation: async (conversationId) => {
    const response = await api.get(`/chat/conversations/${conversationId}`)
    return response.data
  },

  sendMessage: async (conversationId, content) => {
    const response = await api.post(`/chat/conversations/${conversationId}/messages`, {
      content,
    })
    return response.data
  },

  deleteConversation: async (conversationId) => {
    const response = await api.delete(`/chat/conversations/${conversationId}`)
    return response.data
  },
}
