import api from './api'

// 自定义定时提醒：nextFireAt 落库 + 前台轮询拉取到点投递，无推送通道
export const reminderService = {
  list: async () => (await api.get('/reminders/scheduled')).data.reminders,
  create: async (payload) => (await api.post('/reminders/scheduled', payload)).data.reminder,
  update: async (id, payload) => (await api.put(`/reminders/scheduled/${id}`, payload)).data.reminder,
  remove: async (id) => (await api.delete(`/reminders/scheduled/${id}`)).data,
  listDue: async () => (await api.get('/reminders/due')).data.deliveries,
  ack: async (deliveryId, action) => (await api.post(`/reminders/deliveries/${deliveryId}/ack`, { action })).data.delivery,
}
