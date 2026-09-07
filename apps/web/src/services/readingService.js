import api from './api'

export const readingService = {
  listBooks: async () => {
    const response = await api.get('/reading/books')
    return response.data
  },

  addBook: async (data) => {
    const response = await api.post('/reading/books', data)
    return response.data
  },

  updateBook: async (id, data) => {
    const response = await api.put(`/reading/books/${id}`, data)
    return response.data
  },

  deleteBook: async (id) => {
    const response = await api.delete(`/reading/books/${id}`)
    return response.data
  },

  listNotes: async (bookId) => {
    const response = await api.get(`/reading/books/${bookId}/notes`)
    return response.data
  },

  addNote: async (bookId, data) => {
    const response = await api.post(`/reading/books/${bookId}/notes`, data)
    return response.data
  },

  deleteNote: async (noteId) => {
    const response = await api.delete(`/reading/notes/${noteId}`)
    return response.data
  },

  // AI 回应：失败原样抛出（含 response.data.code），由页面内联处理
  requestNoteComment: async (noteId) => {
    const response = await api.post(`/reading/notes/${noteId}/comment`)
    return response.data
  },
}
