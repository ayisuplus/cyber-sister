import { describe, it, expect, vi, afterEach } from 'vitest'
vi.mock('../platform/native', () => ({ isIOSApp: () => true }))
vi.mock('../platform/mobileSession', () => ({ getMobileAccessToken: () => 'expired-access', refreshMobileSession: vi.fn() }))
import { refreshMobileSession } from '../platform/mobileSession'
import { refreshAccessToken } from './api'
import { getSessionVersion } from './sessionLifecycle'

describe('native refresh failure identity boundary', () => {
  afterEach(() => vi.clearAllMocks())
  it('preserves account and draft lifetime on temporary network or server failures', async () => {
    for (const error of [new Error('offline'), { response: { status: 503 } }]) {
      const version = getSessionVersion()
      refreshMobileSession.mockRejectedValueOnce(error)
      await expect(refreshAccessToken()).rejects.toBe(error)
      expect(getSessionVersion()).toBe(version)
    }
  })
  it('clears the account when the server confirms that refresh credentials are rejected', async () => {
    const version = getSessionVersion()
    refreshMobileSession.mockRejectedValueOnce({ response: { status: 401 } })
    await expect(refreshAccessToken()).rejects.toMatchObject({ response: { status: 401 } })
    expect(getSessionVersion()).toBe(version + 1)
  })
})
