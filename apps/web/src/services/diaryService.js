import api from './api'

export const diaryService = {
  listMonth: async (month) => {
    const response = await api.get('/diary', { params: { month } })
    return response.data
  },

  getDay: async (day) => {
    const response = await api.get(`/diary/${day}`)
    return response.data
  },

  saveDay: async (day, data) => {
    const response = await api.put(`/diary/${day}`, data)
    return response.data
  },

  removeDay: async (day) => {
    const response = await api.delete(`/diary/${day}`)
    return response.data
  },

  // AI 回应：失败原样抛出（含 response.data.code），由页面内联处理
  requestComment: async (day) => {
    const response = await api.post(`/diary/${day}/comment`)
    return response.data
  },
}
