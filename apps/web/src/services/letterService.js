import api from './api'

// 历史信件与云端写信预览共用鉴权后端；当前预览固定模拟、不入库。
export const letterService = {
  list: async () => (await api.get('/letters')).data,
  get: async (id) => (await api.get(`/letters/${id}`)).data,
  generate: async () => (await api.post('/letters/generate')).data,
}
