import { describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

import api from './api'
import { complianceService } from './complianceService'

describe('complianceService', () => {
  it('reports a crisis with its trigger message and level', async () => {
    api.post.mockResolvedValue({ data: { recorded: true } })

    const result = await complianceService.reportCrisis('危险发言', 'high')

    expect(api.post).toHaveBeenCalledWith('/compliance/crisis', { triggerMsg: '危险发言', level: 'high' })
    expect(result).toEqual({ recorded: true })
  })

  it('starts, heartbeats and ends a usage session', async () => {
    api.post.mockResolvedValue({ data: { ok: true } })

    await complianceService.startUsage()
    await complianceService.heartbeat()
    await complianceService.endUsage()

    expect(api.post).toHaveBeenNthCalledWith(1, '/compliance/usage/start')
    expect(api.post).toHaveBeenNthCalledWith(2, '/compliance/usage/heartbeat')
    expect(api.post).toHaveBeenNthCalledWith(3, '/compliance/usage/end')
  })

  it('returns the current usage status payload', async () => {
    api.get.mockResolvedValue({ data: { minutes: 42 } })

    const result = await complianceService.getUsageStatus()

    expect(api.get).toHaveBeenCalledWith('/compliance/usage/status')
    expect(result).toEqual({ minutes: 42 })
  })

  it('propagates request failures to the caller', async () => {
    api.post.mockRejectedValue(new Error('network down'))

    await expect(complianceService.startUsage()).rejects.toThrow('network down')
  })
})
