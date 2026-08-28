import api from './api'

export const toolsService = {
  // 待办
  getTodos: async () => {
    const response = await api.get('/tools/todos')
    return response.data
  },

  createTodo: async (content, dueDate) => {
    const response = await api.post('/tools/todos', { content, dueDate })
    return response.data
  },

  updateTodo: async (id, data) => {
    const response = await api.put(`/tools/todos/${id}`, data)
    return response.data
  },

  deleteTodo: async (id) => {
    const response = await api.delete(`/tools/todos/${id}`)
    return response.data
  },

  // 倒数日
  getCountdowns: async () => {
    const response = await api.get('/tools/countdowns')
    return response.data
  },

  createCountdown: async (title, targetDate) => {
    const response = await api.post('/tools/countdowns', { title, targetDate })
    return response.data
  },

  deleteCountdown: async (id) => {
    const response = await api.delete(`/tools/countdowns/${id}`)
    return response.data
  },

  // 大姨妈
  getPeriodRecords: async () => {
    const response = await api.get('/tools/period')
    return response.data
  },

  createPeriodRecord: async (startDate, endDate, cycleDays) => {
    const response = await api.post('/tools/period', { startDate, endDate, cycleDays })
    return response.data
  },

  // 提醒
  getReminders: async () => {
    const response = await api.get('/tools/reminders')
    return response.data
  },

  updateReminder: async (id, data) => {
    const response = await api.put(`/tools/reminders/${id}`, data)
    return response.data
  },

  // 天气
  getWeather: async () => {
    const response = await api.get('/tools/weather')
    return response.data
  },
}
