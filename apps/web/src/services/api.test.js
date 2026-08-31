import { describe, expect, it } from 'vitest'
import api, { API_TIMEOUT_MS } from './api'

describe('API timeout budget', () => {
  it('keeps the browser outside the server model budget', () => {
    expect(API_TIMEOUT_MS).toBe(75_000)
    expect(api.defaults.timeout).toBe(API_TIMEOUT_MS)
  })
})
