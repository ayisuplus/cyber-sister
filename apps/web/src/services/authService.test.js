import { describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  default: {
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

import api from './api'
import { authService } from './authService'

describe('authService', () => {
  it('posts login credentials and returns the session payload', async () => {
    api.post.mockResolvedValue({ data: { token: 't', user: { id: 'u1' } } })

    const result = await authService.login('13800000000', '123456')

    expect(api.post).toHaveBeenCalledWith('/auth/login', { phone: '13800000000', code: '123456' })
    expect(result).toEqual({ token: 't', user: { id: 'u1' } })
  })

  it('refreshes and logs out through the auth endpoints', async () => {
    api.post.mockResolvedValue({ data: { ok: true } })

    await authService.refresh()
    await authService.logout()

    expect(api.post).toHaveBeenNthCalledWith(1, '/auth/refresh')
    expect(api.post).toHaveBeenNthCalledWith(2, '/auth/logout')
  })

  it('updates the persona preference', async () => {
    api.put.mockResolvedValue({ data: { persona: 'rational' } })

    const result = await authService.updatePersona('rational')

    expect(api.put).toHaveBeenCalledWith('/user/persona', { persona: 'rational' })
    expect(result).toEqual({ persona: 'rational' })
  })

  it('updates the roleplay setting', async () => {
    api.put.mockResolvedValue({ data: { roleName: '同桌的你', roleSetting: '爱吐槽' } })

    const result = await authService.updateRolePlay({ name: '同桌的你', setting: '爱吐槽' })

    expect(api.put).toHaveBeenCalledWith('/user/roleplay', { name: '同桌的你', setting: '爱吐槽' })
    expect(result).toEqual({ roleName: '同桌的你', roleSetting: '爱吐槽' })
  })

  it('clears the roleplay setting', async () => {
    api.delete.mockResolvedValue({ data: { success: true } })

    const result = await authService.clearRolePlay()

    expect(api.delete).toHaveBeenCalledWith('/user/roleplay')
    expect(result).toEqual({ success: true })
  })

  it('propagates request failures to the caller', async () => {
    api.post.mockRejectedValue(new Error('invalid code'))

    await expect(authService.login('13800000000', '000000')).rejects.toThrow('invalid code')
  })
})
