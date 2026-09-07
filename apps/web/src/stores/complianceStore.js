import { create } from 'zustand'
import { complianceService } from '../services/complianceService'

export const useComplianceStore = create((set, get) => ({
  // 模态框状态
  showCrisisModal: false,
  showUsageReminder: false,
  showAIDisclaimer: false,
  crisisLevel: null, // 'medium' | 'high'

  // 使用时长追踪
  usageStartTime: null,
  usageMinutes: 0,
  hasShownDisclaimer: false,

  // 首次AI身份提示
  checkFirstVisit: () => {
    const shown = localStorage.getItem('cyber-sister-disclaimer-shown')
    if (!shown) {
      set({ showAIDisclaimer: true })
    }
  },

  dismissDisclaimer: () => {
    set({ showAIDisclaimer: false, hasShownDisclaimer: true })
    localStorage.setItem('cyber-sister-disclaimer-shown', 'true')
  },

  // 使用时长管理
  startSession: async () => {
    try {
      const status = await complianceService.startUsage()
      set({
        usageStartTime: Date.now(),
        // start 响应自带 usageTracker 状态：拿到就以服务端口径为准
        serverUsage: status && typeof status.shouldRemind === 'boolean'
          ? { minutes: status.minutes ?? null, shouldRemind: status.shouldRemind }
          : null,
      })
    } catch {
      // 非核心计时失败不影响聊天，也不记录可能含凭据的请求对象。
      set({ usageStartTime: Date.now() })
    }
  },

  // 最近一次心跳拿到的服务端计时口径（usageTracker）；null = 尚未对时
  serverUsage: null, // { minutes: number | null, shouldRemind: boolean } | null

  // 提醒口径单源化：服务端 usageTracker 的 shouldRemind 已通过 /compliance/usage/heartbeat
  // 透出。本方法保持同步契约（ChatPage 的 60s interval 在 act/fake-timer 下直接消费
  // 布尔返回值）：每次检查异步发心跳刷新 serverUsage，判定优先用已缓存的服务端口径，
  // 首次对时前或心跳失败才回退本地 120 分钟计时兜底。
  checkUsageTime: () => {
    try {
      Promise.resolve(complianceService.heartbeat())
        .then((status) => {
          if (status && typeof status.shouldRemind === 'boolean') {
            set({ serverUsage: { minutes: status.minutes ?? null, shouldRemind: status.shouldRemind } })
          }
        })
        .catch(() => { /* 心跳失败维持本地兜底 */ })
    } catch { /* 同步异常同样维持本地兜底 */ }

    const { usageStartTime, serverUsage } = get()
    if (!usageStartTime && !serverUsage) return false
    const localMinutes = usageStartTime ? Math.floor((Date.now() - usageStartTime) / 60000) : 0
    const minutes = serverUsage?.minutes ?? localMinutes
    set({ usageMinutes: minutes })
    // 2小时 = 120分钟；有服务端口径时以服务端为准
    const shouldRemind = serverUsage ? serverUsage.shouldRemind : localMinutes >= 120
    if (shouldRemind && !get().showUsageReminder) {
      set({ showUsageReminder: true })
      return true
    }
    return false
  },

  dismissUsageReminder: () => {
    set({ showUsageReminder: false })
  },

  resetSession: () => {
    set({ usageStartTime: Date.now(), usageMinutes: 0, showUsageReminder: false, serverUsage: null })
  },

  endSession: async () => {
    try {
      await complianceService.endUsage()
    } catch {
      // 非核心计时失败不影响退出流程。
    }
    set({ usageStartTime: null, usageMinutes: 0, serverUsage: null })
  },

  // 危机干预
  triggerCrisis: async (level, triggerMsg = '') => {
    try {
      await complianceService.reportCrisis(triggerMsg, level)
    } catch {
      // 主聊天危机事务由服务端完成，此兼容上报失败时静默降级。
    }
    set({ showCrisisModal: true, crisisLevel: level })
  },

  dismissCrisis: () => {
    set({ showCrisisModal: false, crisisLevel: null })
  },
}))
