import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/complianceService', () => ({
  complianceService: {
    reportCrisis: vi.fn(),
    startUsage: vi.fn(),
    heartbeat: vi.fn(),
    endUsage: vi.fn(),
    getUsageStatus: vi.fn(),
  },
}))

import { complianceService } from '../services/complianceService'
import { useComplianceStore } from './complianceStore'

const resetStore = () => useComplianceStore.setState({
  showCrisisModal: false,
  showUsageReminder: false,
  showAIDisclaimer: false,
  crisisLevel: null,
  usageStartTime: null,
  usageMinutes: 0,
  hasShownDisclaimer: false,
  serverUsage: null,
})

describe('complianceStore AI disclaimer', () => {
  beforeEach(resetStore)

  it('shows the AI disclaimer on the very first visit', () => {
    useComplianceStore.getState().checkFirstVisit()

    expect(useComplianceStore.getState().showAIDisclaimer).toBe(true)
  })

  it('does not show the disclaimer again once acknowledged', () => {
    localStorage.setItem('cyber-sister-disclaimer-shown', 'true')

    useComplianceStore.getState().checkFirstVisit()

    expect(useComplianceStore.getState().showAIDisclaimer).toBe(false)
  })

  it('persists the acknowledgement when dismissed', () => {
    useComplianceStore.setState({ showAIDisclaimer: true })

    useComplianceStore.getState().dismissDisclaimer()

    expect(useComplianceStore.getState()).toMatchObject({
      showAIDisclaimer: false,
      hasShownDisclaimer: true,
    })
    expect(localStorage.getItem('cyber-sister-disclaimer-shown')).toBe('true')
  })
})

describe('complianceStore usage session', () => {
  beforeEach(resetStore)

  it('starts timing when the server accepts the session', async () => {
    complianceService.startUsage.mockResolvedValue({})

    await useComplianceStore.getState().startSession()

    expect(complianceService.startUsage).toHaveBeenCalled()
    expect(useComplianceStore.getState().usageStartTime).not.toBeNull()
  })

  it('still times locally when the server tracking call fails', async () => {
    complianceService.startUsage.mockRejectedValue(new Error('offline'))

    await useComplianceStore.getState().startSession()

    expect(useComplianceStore.getState().usageStartTime).not.toBeNull()
  })

  it('reports no reminder before a session starts', () => {
    expect(useComplianceStore.getState().checkUsageTime()).toBe(false)
    expect(useComplianceStore.getState().usageMinutes).toBe(0)
  })

  it('tracks elapsed minutes without nagging below the two-hour line', () => {
    // 心跳不可用（mock 未设定返回值）→ 回退本地计时
    useComplianceStore.setState({ usageStartTime: Date.now() - 30 * 60_000 })

    expect(useComplianceStore.getState().checkUsageTime()).toBe(false)
    expect(useComplianceStore.getState().usageMinutes).toBe(30)
    expect(useComplianceStore.getState().showUsageReminder).toBe(false)
  })

  it('raises the usage reminder once two hours have passed', () => {
    useComplianceStore.setState({ usageStartTime: Date.now() - 121 * 60_000 })

    expect(useComplianceStore.getState().checkUsageTime()).toBe(true)
    expect(useComplianceStore.getState().showUsageReminder).toBe(true)
  })

  it('服务端口径对时后优先于本地时钟：本地未满两小时也按 shouldRemind 提醒', async () => {
    complianceService.heartbeat.mockResolvedValue({ minutes: 121, shouldRemind: true, isActive: true })
    useComplianceStore.setState({ usageStartTime: Date.now() - 5 * 60_000 })

    // 首次检查：服务端口径未回来，本地兜底（5 分钟不提醒），同时发出心跳
    expect(useComplianceStore.getState().checkUsageTime()).toBe(false)
    expect(complianceService.heartbeat).toHaveBeenCalled()
    await new Promise((resolve) => { setTimeout(resolve, 0) }) // 等心跳落定
    expect(useComplianceStore.getState().serverUsage).toEqual({ minutes: 121, shouldRemind: true })

    // 对时后：以服务端口径为准（本地只有 5 分钟也提醒）
    expect(useComplianceStore.getState().checkUsageTime()).toBe(true)
    expect(useComplianceStore.getState().usageMinutes).toBe(121)
    expect(useComplianceStore.getState().showUsageReminder).toBe(true)
  })

  it('服务端说未到时本地超两小时也不提醒（服务端口径优先）', () => {
    useComplianceStore.setState({
      usageStartTime: Date.now() - 200 * 60_000,
      serverUsage: { minutes: 30, shouldRemind: false },
    })

    expect(useComplianceStore.getState().checkUsageTime()).toBe(false)
    expect(useComplianceStore.getState().usageMinutes).toBe(30)
    expect(useComplianceStore.getState().showUsageReminder).toBe(false)
  })

  it('心跳失败时维持本地 120 分钟兜底', async () => {
    complianceService.heartbeat.mockRejectedValue(new Error('offline'))
    useComplianceStore.setState({ usageStartTime: Date.now() - 121 * 60_000 })

    expect(useComplianceStore.getState().checkUsageTime()).toBe(true)
    expect(useComplianceStore.getState().showUsageReminder).toBe(true)
    await new Promise((resolve) => { setTimeout(resolve, 0) }) // 失败不写入服务端口径
    expect(useComplianceStore.getState().serverUsage).toBeNull()
  })

  it('startSession 用服务端 start 响应预填计时口径', async () => {
    complianceService.startUsage.mockResolvedValue({ minutes: 0, shouldRemind: false, isActive: true })

    await useComplianceStore.getState().startSession()

    expect(useComplianceStore.getState().serverUsage).toEqual({ minutes: 0, shouldRemind: false })
  })

  it('dismisses the reminder and resets the session clock', () => {
    useComplianceStore.setState({ showUsageReminder: true, usageMinutes: 121 })

    useComplianceStore.getState().dismissUsageReminder()
    expect(useComplianceStore.getState().showUsageReminder).toBe(false)

    useComplianceStore.getState().resetSession()
    expect(useComplianceStore.getState().usageMinutes).toBe(0)
    expect(useComplianceStore.getState().usageStartTime).not.toBeNull()
  })

  it('ends the session and clears timing even when the server call fails', async () => {
    complianceService.endUsage.mockRejectedValue(new Error('offline'))
    useComplianceStore.setState({ usageStartTime: Date.now(), usageMinutes: 45 })

    await useComplianceStore.getState().endSession()

    expect(complianceService.endUsage).toHaveBeenCalled()
    expect(useComplianceStore.getState()).toMatchObject({ usageStartTime: null, usageMinutes: 0 })
  })
})

describe('complianceStore crisis intervention', () => {
  beforeEach(resetStore)

  it('reports the crisis and opens the modal with its level', async () => {
    complianceService.reportCrisis.mockResolvedValue({})

    await useComplianceStore.getState().triggerCrisis('high', '触发内容')

    expect(complianceService.reportCrisis).toHaveBeenCalledWith('触发内容', 'high')
    expect(useComplianceStore.getState()).toMatchObject({ showCrisisModal: true, crisisLevel: 'high' })
  })

  it('still opens the modal when the compatibility report fails', async () => {
    complianceService.reportCrisis.mockRejectedValue(new Error('offline'))

    await useComplianceStore.getState().triggerCrisis('medium')

    expect(useComplianceStore.getState()).toMatchObject({ showCrisisModal: true, crisisLevel: 'medium' })
  })

  it('closes the modal and clears the level on dismiss', () => {
    useComplianceStore.setState({ showCrisisModal: true, crisisLevel: 'high' })

    useComplianceStore.getState().dismissCrisis()

    expect(useComplianceStore.getState()).toMatchObject({ showCrisisModal: false, crisisLevel: null })
  })
})
