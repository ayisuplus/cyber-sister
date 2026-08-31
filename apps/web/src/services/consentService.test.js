import { describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
  },
}))

import api from './api'
import { consentService } from './consentService'

describe('consentService', () => {
  it('reads the external LLM consent state', async () => {
    api.get.mockResolvedValue({ data: { accepted: null, version: 'v1' } })

    const result = await consentService.get()

    expect(api.get).toHaveBeenCalledWith('/user/external-llm-consent')
    expect(result).toEqual({ accepted: null, version: 'v1' })
  })

  it('records an explicit consent decision', async () => {
    api.put.mockResolvedValue({ data: { accepted: true, version: 'v1' } })

    const result = await consentService.update(true)

    expect(api.put).toHaveBeenCalledWith('/user/external-llm-consent', { accepted: true })
    expect(result.accepted).toBe(true)
  })

  it('propagates request failures to the caller', async () => {
    api.get.mockRejectedValue(new Error('offline'))

    await expect(consentService.get()).rejects.toThrow('offline')
  })
})
