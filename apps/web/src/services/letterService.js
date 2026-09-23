import api from './api'

// 「她的来信」：读取与看信时的动作。生成是打开「她」页时的幂等调用（到日子才写），
// 「带去对话」纯前端拼草稿不走这里；「同意采纳」走 decide，服务端执行改/删记忆或建安排。
export const letterService = {
  generate: async () => (await api.post('/letters/generate')).data,
  list: async () => (await api.get('/letters')).data.letters,
  get: async (id) => (await api.get(`/letters/${id}`)).data.letter,
  read: async (id) => (await api.post(`/letters/${id}/read`)).data,
  decide: async (id, index, payload) => (await api.post(`/letters/${id}/suggestions/${index}/decide`, payload)).data,
}
