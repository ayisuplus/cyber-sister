import api from './api'

export const localModelService = {
  getStatus: async () => {
    const response = await api.get('/llm/status')
    return response.data
  },

  getConfig: async () => {
    const response = await api.get('/admin/llm/local/config')
    return response.data
  },

  detect: async (preset) => {
    const response = await api.post('/admin/llm/local/detect', { preset })
    return response.data
  },

  test: async ({ baseUrl, model }) => {
    const response = await api.post('/admin/llm/local/test', {
      baseUrl,
      model,
    })
    return response.data
  },

  update: async ({ enabled, baseUrl, model }) => {
    const response = await api.put('/admin/llm/local/config', {
      enabled,
      baseUrl: baseUrl || null,
      model: model || null,
    })
    return response.data
  },
}
