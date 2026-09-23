import api from './api'

// 「安排」的增删改查；到点的提醒由她在对话里说（见 services/nudgeService.js）
export const reminderService = {
  list: async () => (await api.get('/reminders/scheduled')).data.reminders,
  create: async (payload) => (await api.post('/reminders/scheduled', payload)).data.reminder,
  update: async (id, payload) => (await api.put(`/reminders/scheduled/${id}`, payload)).data.reminder,
  remove: async (id) => (await api.delete(`/reminders/scheduled/${id}`)).data,
}
