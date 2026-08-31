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
