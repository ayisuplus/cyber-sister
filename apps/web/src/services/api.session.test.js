import { beforeEach, describe, expect, it, vi } from 'vitest'
import api from './api'
import { getSessionVersion, resetSession } from './sessionLifecycle'

const persistAccount = (id) => localStorage.setItem('cyber-sister-auth', JSON.stringify({
  state: { token: `account-${id}-token`, user: { id }, isLoggedIn: true },
}))

// 保留真实 Axios 拦截器和 Promise 调度，只替换 HTTP adapter，绝不发网络请求。
const successfulAdapter = () => vi.fn((config) => Promise.resolve({
  config, status: 200, statusText: 'OK', headers: {}, data: { success: true },
}))

describe('api request identity at dispatch', () => {
  beforeEach(() => {
    resetSession()
    persistAccount('A')
  })

  it('captures A synchronously and rejects its result when a queued microtask switches to B', async () => {
    const session = getSessionVersion()
    const adapter = successfulAdapter()
    queueMicrotask(() => {
      resetSession()
      persistAccount('B')
    })

    const pending = api.post('/reminders/scheduled', { content: 'account A task' }, { adapter })

    await expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
    expect(adapter).toHaveBeenCalledOnce()
    const config = adapter.mock.calls[0][0]
    expect(config.headers.Authorization).toBe('Bearer account-A-token')
    expect(config._sessionVersion).toBe(session)
    expect(JSON.parse(localStorage.getItem('cyber-sister-auth')).state.user.id).toBe('B')
  })

  it('rejects a stale replay before the adapter can send it under another account', async () => {
    const session = getSessionVersion()
    resetSession()
    persistAccount('B')
    const adapter = successfulAdapter()

    await expect(api.post('/reminders/scheduled', { content: 'account A task' }, {
      adapter, _sessionVersion: session,
    })).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
    expect(adapter).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem('cyber-sister-auth')).state.user.id).toBe('B')
  })
})
