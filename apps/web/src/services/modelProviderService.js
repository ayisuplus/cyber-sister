import api from './api'

// 模型供应商（/api/admin/model-providers，2026-09-22 起）：实例管理员在应用里配多家
// OpenAI 兼容的聊天模型，网关按顺序依次尝试。key 只写不读，列表只回 hasKey。
// 「试一下」会真发一次最小请求，会花一点点钱。
// 写接口的响应体里除了结果，还可能在网关没能重装时带一句 warning，所以原样返回、不在这里拆。
export const modelProviderService = {
  list: async () => (await api.get('/admin/model-providers')).data.providers,
  create: async (fields) => (await api.post('/admin/model-providers', fields)).data,
  update: async (id, fields) => (await api.put(`/admin/model-providers/${id}`, fields)).data,
  reorder: async (ids) => (await api.put('/admin/model-providers/order', { ids })).data,
  remove: async (id) => (await api.delete(`/admin/model-providers/${id}`)).data,
  test: async (id) => (await api.post(`/admin/model-providers/${id}/test`)).data,
}
