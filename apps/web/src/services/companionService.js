import api from './api'

export const companionService = {
  get: async () => (await api.get('/user/companion')).data,
  recover: async (expectedRevision) => (await api.post('/user/companion/recover', { expectedRevision })).data,
  // 「她这几天」手账：最近 7 天她为你做过、有记录的事
  journal: async () => (await api.get('/user/companion/journal')).data,
}
