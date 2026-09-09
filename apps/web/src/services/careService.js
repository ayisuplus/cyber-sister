import api from './api'

// 「她来想你」主动关怀触点：in-app 拉取，无推送通道
export const careService = {
  list: async () => (await api.get('/care/touchpoints')).data,
  dismiss: async (key) => (await api.post('/care/touchpoints/dismiss', { key })).data,
}
