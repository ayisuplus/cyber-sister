import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/authService', () => ({
  authService: {
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    updatePersona: vi.fn(),
  },
}))

import { authService } from '../services/authService'
import { useAuthStore } from './authStore'
import { useChatStore } from './chatStore'

const loggedInState = {
  token: 'access-token',
  user: { id: 'u1', persona: 'gentle' },
  isLoggedIn: true,
}

describe('authStore logout', () => {
  beforeEach(() => {
    useAuthStore.setState(loggedInState)
    useChatStore.setState({
      conversations: [{ id: 'private-conversation' }],
      currentConversationId: 'private-conversation',
      messages: [{ id: 'private-message', content: '账号 A 的消息' }],
    })
  })

  it('preserves local auth when server-side revocation is not confirmed', async () => {
    authService.logout.mockRejectedValue(new Error('database unavailable'))

    await expect(useAuthStore.getState().logout()).rejects.toThrow('database unavailable')
    expect(useAuthStore.getState()).toMatchObject(loggedInState)
    expect(useChatStore.getState().messages).toHaveLength(1)
  })

  it('clears local auth after confirmed revocation', async () => {
    authService.logout.mockResolvedValue({ success: true })

    await useAuthStore.getState().logout()

    expect(useAuthStore.getState()).toMatchObject({ token: null, user: null, isLoggedIn: false })
    expect(useChatStore.getState()).toMatchObject({
      conversations: [],
      currentConversationId: null,
      messages: [],
    })
  })
})
describe('authStore session lifecycle', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: null, user: null, isLoggedIn: false })
  })

  it('logs in and exposes the returned session', async () => {
    authService.login.mockResolvedValue({ token: 'fresh-token', user: { id: 'u1', persona: 'toxic' } })

    const user = await useAuthStore.getState().login('13800000000', '123456')

    expect(authService.login).toHaveBeenCalledWith('13800000000', '123456')
    expect(user).toEqual({ id: 'u1', persona: 'toxic' })
    expect(useAuthStore.getState()).toMatchObject({
      token: 'fresh-token',
      user: { id: 'u1', persona: 'toxic' },
      isLoggedIn: true,
    })
  })

  it('refreshes the access token', async () => {
    useAuthStore.setState(loggedInState)
    authService.refresh.mockResolvedValue({ token: 'rotated-token' })

    const token = await useAuthStore.getState().refreshAuth()

    expect(token).toBe('rotated-token')
    expect(useAuthStore.getState().token).toBe('rotated-token')
    expect(useAuthStore.getState().isLoggedIn).toBe(true)
  })

  it('clears the local session and chat state when refresh is rejected', async () => {
    useAuthStore.setState(loggedInState)
    useChatStore.setState({ messages: [{ id: 'private-message' }] })
    authService.refresh.mockRejectedValue(new Error('refresh expired'))

    await expect(useAuthStore.getState().refreshAuth()).rejects.toThrow('refresh expired')
    expect(useAuthStore.getState()).toMatchObject({ token: null, user: null, isLoggedIn: false })
    expect(useChatStore.getState().messages).toEqual([])
  })

  it('applies a persona change to the stored user', async () => {
    useAuthStore.setState(loggedInState)
    authService.updatePersona.mockResolvedValue({ persona: 'rational' })

    const persona = await useAuthStore.getState().updatePersona('rational')

    expect(persona).toBe('rational')
    expect(useAuthStore.getState().user.persona).toBe('rational')
  })

  it('ignores persona updates when logged out', async () => {
    authService.updatePersona.mockResolvedValue({ persona: 'rational' })

    await useAuthStore.getState().updatePersona('rational')

    expect(useAuthStore.getState().user).toBeNull()
  })

  it('merges profile updates into the stored user', () => {
    useAuthStore.setState(loggedInState)

    useAuthStore.getState().updateProfile({ nickname: '新昵称' })

    expect(useAuthStore.getState().user).toMatchObject({ id: 'u1', nickname: '新昵称' })
  })

  it('flips the VIP flag on the stored user only', () => {
    useAuthStore.getState().setVip(true)
    expect(useAuthStore.getState().user).toBeNull()

    useAuthStore.setState(loggedInState)
    useAuthStore.getState().setVip(true)

    expect(useAuthStore.getState().user.isVip).toBe(true)
  })
})
