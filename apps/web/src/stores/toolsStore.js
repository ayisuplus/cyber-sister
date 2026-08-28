import { create } from 'zustand'
import { toolsService } from '../services/toolsService'

export const useToolsStore = create(
  (set, get) => ({
    // 待办
    todos: [],

    loadTodos: async () => {
      try {
        const todos = await toolsService.getTodos()
        set({ todos })
      } catch (error) {
        console.error('加载待办列表失败:', error)
      }
    },

    addTodo: async (content, dueDate) => {
      try {
        const todo = await toolsService.createTodo(content, dueDate)
        set((state) => ({ todos: [todo, ...state.todos] }))
        return todo
      } catch (error) {
        console.error('创建待办失败:', error)
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
        console.error('更新待办失败:', error)
      }
    },

    deleteTodo: async (id) => {
      try {
        await toolsService.deleteTodo(id)
        set((state) => ({ todos: state.todos.filter((t) => t.id !== id) }))
      } catch (error) {
        console.error('删除待办失败:', error)
      }
    },

    // 倒数日
    countdowns: [],

    loadCountdowns: async () => {
      try {
        const countdowns = await toolsService.getCountdowns()
        set({ countdowns })
      } catch (error) {
        console.error('加载倒数日列表失败:', error)
      }
    },

    addCountdown: async (title, targetDate) => {
      try {
        const cd = await toolsService.createCountdown(title, targetDate)
        set((state) => ({ countdowns: [cd, ...state.countdowns] }))
        return cd
      } catch (error) {
        console.error('创建倒数日失败:', error)
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
        console.error('删除倒数日失败:', error)
      }
    },

    // 大姨妈记录
    periodRecords: [],

    loadPeriodRecords: async () => {
      try {
        const records = await toolsService.getPeriodRecords()
        set({ periodRecords: records })
      } catch (error) {
        console.error('加载经期记录失败:', error)
      }
    },

    addPeriodRecord: async (startDate, endDate, cycleDays = 28) => {
      try {
        const record = await toolsService.createPeriodRecord(startDate, endDate, cycleDays)
        set((state) => ({
          periodRecords: [record, ...state.periodRecords],
        }))
        return record
      } catch (error) {
        console.error('创建经期记录失败:', error)
        throw error
      }
    },

    getNextPeriodDate: () => {
      const records = get().periodRecords
      if (records.length === 0) return null
      const latest = records.sort(
        (a, b) => new Date(b.startDate) - new Date(a.startDate)
      )[0]
      const start = new Date(latest.startDate)
      start.setDate(start.getDate() + (latest.cycleDays || 28))
      return start
    },

    getDaysUntilPeriod: () => {
      const next = get().getNextPeriodDate()
      if (!next) return null
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const diff = Math.ceil((next - today) / (1000 * 60 * 60 * 24))
      return Math.max(0, diff)
    },

    // 提醒设置
    reminders: [],

    loadReminders: async () => {
      try {
        const reminders = await toolsService.getReminders()
        set({ reminders })
      } catch (error) {
        console.error('加载提醒列表失败:', error)
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
        console.error('更新提醒失败:', error)
      }
    },

    // 天气
    weather: null,

    loadWeather: async () => {
      try {
        const weather = await toolsService.getWeather()
        set({ weather })
      } catch (error) {
        console.error('加载天气失败:', error)
      }
    },
  })
)
