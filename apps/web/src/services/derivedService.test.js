import { describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

import api from './api'
import { derivedService } from './derivedService'

describe('derivedService', () => {
  it('lists insights with the status filter', async () => {
    api.get.mockResolvedValue({ data: { insights: [{ id: 'i1' }] } })

    const result = await derivedService.list('promoted')

    expect(api.get).toHaveBeenCalledWith('/derived', { params: { status: 'promoted' } })
    expect(result).toEqual({ insights: [{ id: 'i1' }] })
  })

  it('triggers a manual analysis', async () => {
    api.post.mockResolvedValue({ data: { created: 1, skipped: 0 } })

    const result = await derivedService.analyze()

    expect(api.post).toHaveBeenCalledWith('/derived/analyze')
    expect(result).toEqual({ created: 1, skipped: 0 })
  })

  it('promotes and dismisses single insights', async () => {
    api.post.mockResolvedValue({ data: {} })

    await derivedService.promote('i1', { type: 'episodic', importance: 8, tags: ['学习'] })
    await derivedService.dismiss('i2')

    expect(api.post).toHaveBeenNthCalledWith(1, '/derived/i1/promote', { type: 'episodic', importance: 8, tags: ['学习'] })
    expect(api.post).toHaveBeenNthCalledWith(2, '/derived/i2/dismiss')
  })

  it('clears the whole workspace', async () => {
    api.delete.mockResolvedValue({ data: { cleared: 3 } })

    const result = await derivedService.clear()

    expect(api.delete).toHaveBeenCalledWith('/derived')
    expect(result).toEqual({ cleared: 3 })
  })
})
