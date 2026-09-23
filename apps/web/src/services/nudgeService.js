import api from './api'

// 她主动说的话：到点的安排、她来想你、每周的信，合成一条时间线在对话里出现。
export const nudgeService = {
  list: async () => (await api.get('/chat/nudges')).data,
  ack: async (id, action = 'shown') => (await api.post(`/chat/nudges/${encodeURIComponent(id)}/ack`, { action })).data,
}
