import { create } from 'zustand'
import { toolsService } from '../services/toolsService'
import { addDays, differenceInCalendarDays, parseISO, startOfDay } from 'date-fns'
// axios 错误对象的 config.headers 携带 Authorization，日志只保留状态码/错误名级别的摘要
const summarizeError = (error) => error?.response?.status ?? error?.name ?? 'UnknownError'
// 后端把 'yyyy-MM-dd' 存为 UTC 零点；new Date(iso) 会得到 UTC 午夜（北京时间为当天 08:00），
// 直接和本地日历日零点比较会把记录的第一天标丢。加载边界统一归一化为本地日历日零点
// （startDay/endDay），下游日历标注、下次预测、倒数全部按本地日历日比较。
const toLocalCalendarDay = (iso) => (iso ? startOfDay(parseISO(iso)) : null)
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
      try {
        const todos = await toolsService.getTodos()
        set({ todos })
      } catch (error) {
        console.error('加载待办列表失败:', summarizeError(error))
        throw error
      }
    },

    addTodo: async (content, dueDate, dueTime) => {
      try {
        const todo = await toolsService.createTodo(content, dueDate, dueTime)
        set((state) => ({ todos: [todo, ...state.todos] }))
        return todo
      } catch (error) {
        console.error('创建日程失败:', summarizeError(error))
        throw error
      }
    },

    toggleTodo: async (id) => {
      try {
        const todo = get().todos.find((t) => t.id === id)
        if (!todo) return

        const updated = await toolsService.updateTodo(id, { isDone: !todo.isDone })
        set((state) => ({
          todos: state.todos.map((t) => (t.id === id ? updated : t)),
        }))
      } catch (error) {
        console.error('更新待办失败:', summarizeError(error))
      }
    },

    deleteTodo: async (id) => {
      try {
        await toolsService.deleteTodo(id)
        set((state) => ({ todos: state.todos.filter((t) => t.id !== id) }))
      } catch (error) {
        console.error('删除待办失败:', summarizeError(error))
      }
    },

    // 倒数日
    countdowns: [],

    loadCountdowns: async () => {
      try {
        const countdowns = await toolsService.getCountdowns()
        set({ countdowns })
      } catch (error) {
        console.error('加载倒数日列表失败:', summarizeError(error))
        throw error
      }
    },

    addCountdown: async (title, targetDate) => {
      try {
        const cd = await toolsService.createCountdown(title, targetDate)
        set((state) => ({ countdowns: [cd, ...state.countdowns] }))
        return cd
      } catch (error) {
        console.error('创建倒数日失败:', summarizeError(error))
        throw error
      }
    },

    deleteCountdown: async (id) => {
      try {
        await toolsService.deleteCountdown(id)
        set((state) => ({
          countdowns: state.countdowns.filter((c) => c.id !== id),
        }))
      } catch (error) {
        console.error('删除倒数日失败:', summarizeError(error))
      }
    },

    // 大姨妈记录
    periodRecords: [],

    loadPeriodRecords: async () => {
      try {
        const records = await toolsService.getPeriodRecords()
        set({ periodRecords: records.map(normalizePeriodRecord) })
      } catch (error) {
        console.error('加载经期记录失败:', summarizeError(error))
        throw error
      }
    },

    addPeriodRecord: async (startDate, endDate, cycleDays = 28) => {
      try {
        const record = await toolsService.createPeriodRecord(startDate, endDate, cycleDays)
        set((state) => ({
          periodRecords: [normalizePeriodRecord(record), ...state.periodRecords],
        }))
        return record
      } catch (error) {
        console.error('创建经期记录失败:', summarizeError(error))
        throw error
      }
    },

    getNextPeriodDate: () => {
      const records = get().periodRecords
      if (records.length === 0) return null
      const latest = [...records].sort(
        (a, b) => (b.startDay?.getTime() ?? 0) - (a.startDay?.getTime() ?? 0)
      )[0]
      return addDays(latest.startDay, latest.cycleDays || 28)
    },

    getDaysUntilPeriod: () => {
      const next = get().getNextPeriodDate()
      if (!next) return null
      return Math.max(0, differenceInCalendarDays(next, new Date()))
    },

    // 提醒设置
    reminders: [],

    loadReminders: async () => {
      try {
        const reminders = await toolsService.getReminders()
        set({ reminders })
      } catch (error) {
        console.error('加载提醒列表失败:', summarizeError(error))
      }
    },

    toggleReminder: async (id) => {
      try {
        const reminder = get().reminders.find((r) => r.id === id)
        if (!reminder) return

        const updated = await toolsService.updateReminder(id, {
          isActive: !reminder.isActive,
        })
        set((state) => ({
          reminders: state.reminders.map((r) => (r.id === id ? updated : r)),
        }))
      } catch (error) {
        console.error('更新提醒失败:', summarizeError(error))
      }
    },

    // 天气
    weather: null,

    loadWeather: async () => {
      try {
        const weather = await toolsService.getWeather()
        set({ weather })
      } catch (error) {
        console.error('加载天气失败:', summarizeError(error))
      }
    },
  })
)
