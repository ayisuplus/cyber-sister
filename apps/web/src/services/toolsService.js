import api from './api'

// /api/tools 现只承载经期记录；日程、倒数日与提醒已由「安排」（reminderService）替代
export const toolsService = {
  // 大姨妈
  getPeriodRecords: async () => {
    const response = await api.get('/tools/period')
    return response.data
  },

  createPeriodRecord: async (startDate, endDate, cycleDays) => {
    const response = await api.post('/tools/period', { startDate, endDate, cycleDays })
    return response.data
  },

  getPeriodSummary: async (today) => (await api.get('/tools/period/summary', { params: { today } })).data,
  updatePeriodRecord: async (id, data) => (await api.put(`/tools/period/${id}`, data)).data,
  deletePeriodRecord: async (id) => (await api.delete(`/tools/period/${id}`)).data,
}
