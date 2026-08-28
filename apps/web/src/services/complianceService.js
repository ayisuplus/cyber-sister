import api from './api'

export const complianceService = {
  reportCrisis: async (triggerMsg, level) => {
    const response = await api.post('/compliance/crisis', { triggerMsg, level })
    return response.data
  },

  startUsage: async () => {
    const response = await api.post('/compliance/usage/start')
    return response.data
  },

  heartbeat: async () => {
    const response = await api.post('/compliance/usage/heartbeat')
    return response.data
  },

  endUsage: async () => {
    const response = await api.post('/compliance/usage/end')
    return response.data
  },

  getUsageStatus: async () => {
    const response = await api.get('/compliance/usage/status')
    return response.data
  },
}
