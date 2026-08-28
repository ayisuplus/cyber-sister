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
      await complianceService.startUsage()
      set({ usageStartTime: Date.now() })
    } catch (error) {
      console.error('开始使用计时失败:', error)
      set({ usageStartTime: Date.now() })
    }
  },

  checkUsageTime: () => {
    const { usageStartTime } = get()
    if (!usageStartTime) return false
    const minutes = Math.floor((Date.now() - usageStartTime) / 60000)
    set({ usageMinutes: minutes })
    // 2小时 = 120分钟
    if (minutes >= 120 && !get().showUsageReminder) {
      set({ showUsageReminder: true })
      return true
    }
    return false
  },

  dismissUsageReminder: () => {
    set({ showUsageReminder: false })
  },

  resetSession: () => {
    set({ usageStartTime: Date.now(), usageMinutes: 0, showUsageReminder: false })
  },

  endSession: async () => {
    try {
      await complianceService.endUsage()
    } catch (error) {
      console.error('结束使用计时失败:', error)
    }
    set({ usageStartTime: null, usageMinutes: 0 })
  },

  // 危机干预
  triggerCrisis: async (level, triggerMsg = '') => {
    try {
      await complianceService.reportCrisis(triggerMsg, level)
    } catch (error) {
      console.error('上报危机事件失败:', error)
    }
    set({ showCrisisModal: true, crisisLevel: level })
  },

  dismissCrisis: () => {
    set({ showCrisisModal: false, crisisLevel: null })
  },
}))
