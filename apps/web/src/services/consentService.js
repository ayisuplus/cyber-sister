import api from './api'

export const consentService = {
  get: async () => {
    const response = await api.get('/user/external-llm-consent')
    return response.data
  },
  update: async (accepted) => {
    const response = await api.put('/user/external-llm-consent', { accepted })
    return response.data
  },
}
