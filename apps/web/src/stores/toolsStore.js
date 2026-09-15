import { create } from 'zustand'
import { toolsService } from '../services/toolsService'
import { reminderService } from '../services/reminderService'
import { assertSessionVersion, getSessionVersion, onSessionReset } from '../services/sessionLifecycle'
import { parseISO, startOfDay } from 'date-fns'
// axios 错误对象的 config.headers 携带 Authorization，日志只保留状态码/错误名级别的摘要
const summarizeError = (error) => error?.response?.status ?? error?.name ?? 'UnknownError'
// 后端把 'yyyy-MM-dd' 存为 UTC 零点；new Date(iso) 会得到 UTC 午夜（北京时间为当天 08:00），
// 直接和本地日历日零点比较会把记录的第一天标丢。加载边界统一归一化为本地日历日零点
// （startDay/endDay）仅用于日历标注；周期预测由后端摘要接口提供。
const toLocalCalendarDay = (iso) => (iso ? startOfDay(parseISO(iso.slice(0, 10))) : null)
const normalizePeriodRecord = (record) => ({
  ...record,
  startDay: toLocalCalendarDay(record?.startDate),
  endDay: toLocalCalendarDay(record?.endDate),
})

export const useToolsStore = create(
  (set, get) => ({
    // 待办
    todos: [],

    loadTodos: async () => {
      const session = getSessionVersion()
      try {
        const todos = await toolsService.getTodos()
        assertSessionVersion(session)
        set({ todos })
      } catch (error) {
        console.error('加载待办列表失败:', summarizeError(error))
        throw error
      }
    },

    addTodo: async (content, dueDate, dueTime) => {
      const session = getSessionVersion()
      try {
        const todo = await toolsService.createTodo(content, dueDate, dueTime)
        assertSessionVersion(session)
        set((state) => ({ todos: [todo, ...state.todos] }))
        return todo
      } catch (error) {
        console.error('创建日程失败:', summarizeError(error))
        throw error
      }
    },

    toggleTodo: async (id) => {
      const session = getSessionVersion()
      try {
        const todo = get().todos.find((t) => t.id === id)
        if (!todo) return

        const updated = await toolsService.updateTodo(id, { isDone: !todo.isDone })
        assertSessionVersion(session)
        set((state) => ({
          todos: state.todos.map((t) => (t.id === id ? updated : t)),
        }))
      } catch (error) {
        console.error('更新待办失败:', summarizeError(error))
        throw error
      }
    },

    deleteTodo: async (id) => {
      const session = getSessionVersion()
      try {
        await toolsService.deleteTodo(id)
        assertSessionVersion(session)
        set((state) => ({ todos: state.todos.filter((t) => t.id !== id) }))
      } catch (error) {
        console.error('删除待办失败:', summarizeError(error))
        throw error
      }
    },

    // 倒数日
    countdowns: [],

    loadCountdowns: async () => {
      const session = getSessionVersion()
      try {
        const countdowns = await toolsService.getCountdowns()
        assertSessionVersion(session)
        set({ countdowns })
      } catch (error) {
        console.error('加载倒数日列表失败:', summarizeError(error))
        throw error
      }
    },

    addCountdown: async (title, targetDate) => {
      const session = getSessionVersion()
      try {
        const cd = await toolsService.createCountdown(title, targetDate)
        assertSessionVersion(session)
        set((state) => ({ countdowns: [cd, ...state.countdowns] }))
        return cd
      } catch (error) {
        console.error('创建倒数日失败:', summarizeError(error))
        throw error
      }
    },

    deleteCountdown: async (id) => {
      const session = getSessionVersion()
      try {
        await toolsService.deleteCountdown(id)
        assertSessionVersion(session)
        set((state) => ({
          countdowns: state.countdowns.filter((c) => c.id !== id),
        }))
      } catch (error) {
        console.error('删除倒数日失败:', summarizeError(error))
        throw error
      }
    },

    // 大姨妈记录
    periodRecords: [],

    loadPeriodRecords: async () => {
      const session = getSessionVersion()
      try {
        const records = await toolsService.getPeriodRecords()
        assertSessionVersion(session)
        set({ periodRecords: records.map(normalizePeriodRecord) })
      } catch (error) {
        console.error('加载经期记录失败:', summarizeError(error))
        throw error
      }
    },

    addPeriodRecord: async (startDate, endDate, cycleDays = 28) => {
      const session = getSessionVersion()
      try {
        const record = await toolsService.createPeriodRecord(startDate, endDate, cycleDays)
        assertSessionVersion(session)
        set((state) => ({
          periodRecords: [normalizePeriodRecord(record), ...state.periodRecords],
        }))
        return record
      } catch (error) {
        console.error('创建经期记录失败:', summarizeError(error))
        throw error
      }
    },

    updatePeriodRecord: async (id, payload) => {
      const session = getSessionVersion()
      const record = await toolsService.updatePeriodRecord(id, payload)
      assertSessionVersion(session)
      set((state) => ({ periodRecords: state.periodRecords.map(item => item.id === id ? normalizePeriodRecord(record) : item) }))
      return record
    },

    deletePeriodRecord: async (id) => {
      const session = getSessionVersion()
      await toolsService.deletePeriodRecord(id)
      assertSessionVersion(session)
      set((state) => ({ periodRecords: state.periodRecords.filter(item => item.id !== id) }))
    },

    // 提醒设置
    reminders: [],

    loadReminders: async () => {
      const session = getSessionVersion()
      try {
        const reminders = await toolsService.getReminders()
        assertSessionVersion(session)
        set({ reminders })
      } catch (error) {
        console.error('加载提醒列表失败:', summarizeError(error))
      }
    },

    toggleReminder: async (id) => {
      const session = getSessionVersion()
      try {
        const reminder = get().reminders.find((r) => r.id === id)
        if (!reminder) return

        const updated = await toolsService.updateReminder(id, {
          isActive: !reminder.isActive,
        })
        assertSessionVersion(session)
        set((state) => ({
          reminders: state.reminders.map((r) => (r.id === id ? updated : r)),
        }))
      } catch (error) {
        console.error('更新提醒失败:', summarizeError(error))
        throw error
      }
    },

    // 天气
    weather: null,

    // 自定义定时提醒
    scheduledReminders: [],
    dueDeliveries: [],

    loadScheduledReminders: async () => {
      const session = getSessionVersion()
      try {
        const scheduledReminders = await reminderService.list()
        assertSessionVersion(session)
        set({ scheduledReminders })
      } catch (error) {
        console.error('加载自定义提醒失败:', summarizeError(error))
        throw error
      }
    },

    addScheduledReminder: async (payload) => {
      const session = getSessionVersion()
      const reminder = await reminderService.create(payload)
      assertSessionVersion(session)
      set((state) => ({ scheduledReminders: [...state.scheduledReminders, reminder] }))
      return reminder
    },

    updateScheduledReminder: async (id, payload) => {
      const session = getSessionVersion()
      const updated = await reminderService.update(id, payload)
      assertSessionVersion(session)
      set((state) => ({
        scheduledReminders: state.scheduledReminders.map((r) => (r.id === id ? updated : r)),
      }))
      return updated
    },

    removeScheduledReminder: async (id) => {
      const session = getSessionVersion()
      await reminderService.remove(id)
      assertSessionVersion(session)
      set((state) => ({
        scheduledReminders: state.scheduledReminders.filter((r) => r.id !== id),
      }))
    },

    // 到点投递：前台轮询拉取；ack 后从待办列表移除
    pollDueDeliveries: async () => {
      const session = getSessionVersion()
      try {
        const deliveries = await reminderService.listDue()
        assertSessionVersion(session)
        set({ dueDeliveries: deliveries })
        return deliveries
      } catch (error) {
        console.error('拉取到期提醒失败:', summarizeError(error))
        return []
      }
    },

    ackDelivery: async (deliveryId, action) => {
      const session = getSessionVersion()
      try {
        await reminderService.ack(deliveryId, action)
        assertSessionVersion(session)
        set((state) => ({ dueDeliveries: state.dueDeliveries.filter((d) => d.id !== deliveryId) }))
      } catch (error) {
        console.error('确认提醒投递失败:', summarizeError(error))
      }
    },

    loadWeather: async () => {
      const session = getSessionVersion()
      try {
        const weather = await toolsService.getWeather()
        assertSessionVersion(session)
        set({ weather })
      } catch (error) {
        console.error('加载天气失败:', summarizeError(error))
      }
    },
  })
)

onSessionReset(() => useToolsStore.setState({
  todos: [],
  countdowns: [],
  periodRecords: [],
  reminders: [],
  scheduledReminders: [],
  dueDeliveries: [],
  weather: null,
}))
