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
  // 经期是敏感个人信息：新增、修改与交给她读取前需要单独同意
  getPeriodConsent: async () => (await api.get('/tools/period/consent')).data,
  setPeriodConsent: async (accepted) => (await api.put('/tools/period/consent', { accepted })).data,
  // 聊天时让她顾及你的周期：记录同意之外单独的一项
  getPeriodTone: async () => (await api.get('/tools/period/tone')).data,
  setPeriodTone: async (enabled) => (await api.put('/tools/period/tone', { enabled })).data,
}
