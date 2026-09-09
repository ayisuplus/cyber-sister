import api from './api'

// 「她的信」：每周一封，由服务端基于本周真实数据本地生成
export const letterService = {
  list: async () => (await api.get('/letters')).data,
  get: async (id) => (await api.get(`/letters/${id}`)).data,
  generate: async () => (await api.post('/letters/generate')).data,
}
