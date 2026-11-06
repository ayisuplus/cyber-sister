import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../platform/native', () => ({
  isIOSApp: () => true, isMobileBuild: () => true,
  SessionVault: { read: async () => ({}), write: async () => {}, clear: async () => {} },
}))
vi.mock('../services/authService', () => ({ authService: { login: vi.fn(), logout: vi.fn() } }))
import { authService } from '../services/authService'
import { useAuthStore } from './authStore'
import { useChatStore } from './chatStore'
import { getPersistedToken } from '../services/api'
import { resetSession } from '../services/sessionLifecycle'

describe('mobile auth store persistence and account isolation', () => {
  beforeEach(() => { resetSession(); localStorage.clear() })
  it('does not rehydrate browser credentials or persist native user/token data', async () => {
    localStorage.setItem('cyber-sister-auth', JSON.stringify({ state: { token: 'old', user: { id: 'old' }, isLoggedIn: true } }))
    await useAuthStore.persist.rehydrate()
    expect(useAuthStore.getState().isLoggedIn).toBe(false)
    authService.login.mockResolvedValueOnce({ token: 'native-a', user: { id: 'a' } })
    await useAuthStore.getState().login('13800138000', '123456')
    expect(getPersistedToken()).toBe('native-a')
    expect(JSON.parse(localStorage.getItem('cyber-sister-auth')).state).toEqual({})
    useChatStore.setState({ messages: [{ id: 'private-a', content: 'A only' }] })
    authService.login.mockResolvedValueOnce({ token: 'native-b', user: { id: 'b' } })
    await useAuthStore.getState().login('13900139000', '234567')
    expect(getPersistedToken()).toBe('native-b')
    expect(useChatStore.getState().messages).toEqual([])
    authService.logout.mockResolvedValueOnce({ success: true })
    await useAuthStore.getState().logout()
    expect(getPersistedToken()).toBeNull()
    expect(useAuthStore.getState().isLoggedIn).toBe(false)
  })
})
