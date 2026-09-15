import api from './api'

export const companionService = {
  get: async () => (await api.get('/user/companion')).data,
  recover: async (expectedRevision) => (await api.post('/user/companion/recover', { expectedRevision })).data,
}
