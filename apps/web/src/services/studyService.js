import api from './api'

export const studyService = {
  getActive: async () => (await api.get('/study/active')).data,
  start: async (data) => (await api.post('/study/active', data)).data,
  finish: async (id) => (await api.post(`/study/active/${id}/finish`)).data,
  cancel: async (id) => (await api.delete(`/study/active/${id}`)).data,
  getSummary: async () => {
    const response = await api.get('/study/summary')
    return response.data
  },

  listSessions: async (days = 30) => {
    const response = await api.get('/study/sessions', { params: { days } })
    return response.data
  },

  recordSession: async (data) => {
    const response = await api.post('/study/sessions', data)
    return response.data
  },

  // AI 回应：失败原样抛出（含 response.data.code），由页面内联处理
  requestSessionComment: async (id) => {
    const response = await api.post(`/study/sessions/${id}/comment`)
    return response.data
  },
}
