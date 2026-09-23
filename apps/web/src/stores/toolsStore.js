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
// 生活工具：经期记录，与「安排」（日程、倒数日、提醒、每天的小习惯合成的定时任务）
export const useToolsStore = create(
  (set) => ({
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

    // 安排（定时任务）。到点的提醒由她在对话里说，这里只管增删改查。
    scheduledReminders: [],

    loadScheduledReminders: async () => {
      const session = getSessionVersion()
      try {
        const scheduledReminders = await reminderService.list()
        assertSessionVersion(session)
        set({ scheduledReminders })
      } catch (error) {
        console.error('加载安排失败:', summarizeError(error))
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
  })
)

onSessionReset(() => useToolsStore.setState({
  periodRecords: [],
  scheduledReminders: [],
}))
