import api from './api'

export const derivedService = {
  list: async (status = 'active') => (await api.get('/derived', { params: { status } })).data,
  analyze: async () => (await api.post('/derived/analyze')).data,
  promote: async (id, payload) => (await api.post(`/derived/${id}/promote`, payload)).data,
  resolve: async (id, payload) => (await api.post(`/derived/${id}/resolve`, payload)).data,
  rebuild: async () => (await api.post('/derived/rebuild')).data,
  dismiss: async (id) => (await api.post(`/derived/${id}/dismiss`)).data,
  listEdges: async (status = 'derived') => (await api.get('/derived/edges', { params: { status } })).data,
  promoteEdge: async (id) => (await api.post(`/derived/edges/${id}/promote`)).data,
  dismissEdge: async (id) => (await api.post(`/derived/edges/${id}/dismiss`)).data,
  clear: async () => (await api.delete('/derived')).data,
}
