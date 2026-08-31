import { describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  default: {
    post: vi.fn(),
    put: vi.fn(),
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

  it('propagates request failures to the caller', async () => {
    api.post.mockRejectedValue(new Error('invalid code'))

    await expect(authService.login('13800000000', '000000')).rejects.toThrow('invalid code')
  })
})
