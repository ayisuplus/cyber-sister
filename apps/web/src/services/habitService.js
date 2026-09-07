import api from './api'

export const habitService = {
  list: async () => {
    const response = await api.get('/habits')
    return response.data
  },

  create: async (data) => {
    const response = await api.post('/habits', data)
    return response.data
  },

  update: async (id, data) => {
    const response = await api.patch(`/habits/${id}`, data)
    return response.data
  },

  // 归档：历史打卡保留，习惯不再出现在列表
  archive: async (id) => {
    const response = await api.delete(`/habits/${id}`)
    return response.data
  },

  checkin: async (id) => {
    const response = await api.post(`/habits/${id}/checkin`)
    return response.data
  },

  // 鼓励语：失败原样抛出（含 response.data.code），由页面内联处理
  cheer: async () => {
    const response = await api.post('/habits/cheer')
    return response.data
  },
}
