import { beforeEach, describe, expect, it, vi } from 'vitest'
const vault = vi.hoisted(() => ({ value: null }))
vi.mock('./native', () => ({
  isIOSApp: () => true,
  SessionVault: {
    read: async () => ({ value: vault.value }),
    write: async ({ value }) => { vault.value = value },
    clear: async () => { vault.value = null },
  },
}))
import { getMobileAccessToken, setMobileAccessToken, refreshMobileSession, clearMobileSession } from './mobileSession'
import { resetSession } from '../services/sessionLifecycle'

describe('native session credentials', () => {
  beforeEach(() => { vault.value = null; localStorage.clear(); resetSession() })
  it('keeps access tokens only in memory and clears them across account boundaries', () => {
    setMobileAccessToken('access-a')
    expect(getMobileAccessToken()).toBe('access-a')
    expect(localStorage.length).toBe(0)
    resetSession()
    expect(getMobileAccessToken()).toBeNull()
  })
  it('restores with Keychain, persists rotated credentials before exposing access, then clears both', async () => {
    vault.value = 'refresh-a'
    const send = vi.fn(async (_path, body) => {
      expect(body).toEqual({ refreshToken: 'refresh-a' })
      return { token: 'access-b', refreshToken: 'refresh-b', user: { id: 'b' } }
    })
    expect(await refreshMobileSession(send)).toMatchObject({ user: { id: 'b' } })
    expect(vault.value).toBe('refresh-b')
    expect(getMobileAccessToken()).toBe('access-b')
    expect(localStorage.length).toBe(0)
    await clearMobileSession()
    expect(vault.value).toBeNull()
    expect(getMobileAccessToken()).toBeNull()
  })
  it('preserves Keychain on transport failure but deletes a rejected credential', async () => {
    vault.value = 'refresh-a'
    await expect(refreshMobileSession(async () => { throw new Error('offline') })).rejects.toThrow('offline')
    expect(vault.value).toBe('refresh-a')
    await expect(refreshMobileSession(async () => { throw { response: { status: 401 } } })).rejects.toMatchObject({ response: { status: 401 } })
    expect(vault.value).toBeNull()
  })
})
