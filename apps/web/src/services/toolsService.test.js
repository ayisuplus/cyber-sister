import { describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

import api from './api'
import { toolsService } from './toolsService'

describe('toolsService period', () => {
  it('routes period summary and corrections through the authenticated API client', async () => {
    api.get.mockResolvedValue({ data: { nextDate: '2026-09-30', daysUntil: 18 } })
    api.put.mockResolvedValue({ data: { id: 'p1', cycleDays: 30 } })
    api.delete.mockResolvedValue({ data: { success: true } })
    expect(await toolsService.getPeriodSummary('2026-09-12')).toEqual({ nextDate: '2026-09-30', daysUntil: 18 })
    expect(await toolsService.updatePeriodRecord('p1', { cycleDays: 30 })).toEqual({ id: 'p1', cycleDays: 30 })
    await toolsService.deletePeriodRecord('p1')
    expect(api.get).toHaveBeenCalledWith('/tools/period/summary', { params: { today: '2026-09-12' } })
    expect(api.put).toHaveBeenCalledWith('/tools/period/p1', { cycleDays: 30 })
    expect(api.delete).toHaveBeenCalledWith('/tools/period/p1')
  })
})

describe('toolsService period records', () => {
  it('lists period records', async () => {
    api.get.mockResolvedValue({ data: [{ id: 'p1' }] })

    const result = await toolsService.getPeriodRecords()

    expect(api.get).toHaveBeenCalledWith('/tools/period')
    expect(result).toEqual([{ id: 'p1' }])
  })

  it('creates a period record with cycle length', async () => {
    api.post.mockResolvedValue({ data: { id: 'p1' } })

    await toolsService.createPeriodRecord('2026-08-01', '2026-08-05', 30)

    expect(api.post).toHaveBeenCalledWith('/tools/period', {
      startDate: '2026-08-01',
      endDate: '2026-08-05',
      cycleDays: 30,
    })
  })
})

describe('toolsService retired endpoints', () => {
  it('no longer exposes todo, countdown, legacy reminder or weather calls', () => {
    for (const key of ['getTodos', 'createTodo', 'updateTodo', 'deleteTodo', 'getCountdowns', 'createCountdown', 'deleteCountdown', 'getReminders', 'updateReminder', 'getWeather']) {
      expect(toolsService).not.toHaveProperty(key)
    }
  })

  it('propagates request failures to the caller', async () => {
    api.get.mockRejectedValue(new Error('server error'))

    await expect(toolsService.getPeriodRecords()).rejects.toThrow('server error')
  })
})
