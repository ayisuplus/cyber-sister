import api from './api'

// 化妆间自定义妆容预设：服务端落库，多设备同步
export const makeupPresetService = {
  list: async () => {
    const response = await api.get('/makeup-presets')
    return response.data
  },

  create: async (payload) => {
    const response = await api.post('/makeup-presets', payload)
    return response.data
  },

  rename: async (id, payload) => {
    const response = await api.put(`/makeup-presets/${id}`, payload)
    return response.data
  },

  remove: async (id) => {
    const response = await api.delete(`/makeup-presets/${id}`)
    return response.data
  },
}
