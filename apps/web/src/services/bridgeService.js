import api from './api'

// 本机助手：设置页只管生成连接码、看已连接的电脑、断开；取任务与交结果由电脑上的助手直接和服务端往来。
export const bridgeService = {
  list: async () => (await api.get('/bridge')).data,
  createPairing: async () => (await api.post('/bridge/pairings')).data,
  revoke: async (id) => (await api.delete(`/bridge/${id}`)).data,
}
