import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const instance = vi.fn()
  instance.interceptors = {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  }
  instance.defaults = {}
  return { instance, axiosPost: vi.fn() }
})

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mocks.instance),
    post: mocks.axiosPost,
  },
}))

import api from './api'
import { useAuthStore } from '../stores/authStore'

const attachAuth = (token) => {
  useAuthStore.setState({ token, user: { id: 'u1' }, isLoggedIn: true })
}

const requestInterceptor = mocks.instance.interceptors.request.use.mock.calls[0][0]
const responseErrorInterceptor = mocks.instance.interceptors.response.use.mock.calls[0][1]

const unauthorized = (overrides = {}) => ({
  config: { url: '/chat/conversations', headers: {}, ...overrides.config },
  response: { status: 401 },
  ...overrides,
})

describe('api request interceptor', () => {
  it('attaches the persisted bearer token to outgoing requests', () => {
    attachAuth('access-token')
    const config = { headers: {} }

    const result = requestInterceptor(config)

    expect(result.headers.Authorization).toBe('Bearer access-token')
  })

  it('leaves requests anonymous when no session is persisted', () => {
    const config = { headers: {} }

    requestInterceptor(config)

    expect(config.headers.Authorization).toBeUndefined()
  })

  it('drops corrupted persisted auth instead of crashing the request', () => {
    localStorage.setItem('cyber-sister-auth', '{broken json')
    const config = { headers: {} }

    requestInterceptor(config)

    expect(config.headers.Authorization).toBeUndefined()
    expect(localStorage.getItem('cyber-sister-auth')).toBeNull()
  })

  it('ignores persisted auth state without a token', () => {
    localStorage.setItem('cyber-sister-auth', JSON.stringify({ state: { user: { id: 'u1' } } }))
    const config = { headers: {} }

    requestInterceptor(config)

    expect(config.headers.Authorization).toBeUndefined()
  })
})

describe('api response interceptor', () => {
  beforeEach(() => {
    mocks.instance.mockReset()
    mocks.axiosPost.mockReset()
  })

  it('rejects non-401 errors without attempting a refresh', async () => {
    const error = { config: { url: '/chat', headers: {} }, response: { status: 500 } }

    await expect(responseErrorInterceptor(error)).rejects.toBe(error)
    expect(mocks.axiosPost).not.toHaveBeenCalled()
  })

  it('never tries to refresh for failed login or refresh calls', async () => {
    const loginError = unauthorized({ config: { url: '/auth/login', headers: {} } })
    const refreshError = unauthorized({ config: { url: '/auth/refresh', headers: {} } })

    await expect(responseErrorInterceptor(loginError)).rejects.toBe(loginError)
    await expect(responseErrorInterceptor(refreshError)).rejects.toBe(refreshError)
    expect(mocks.axiosPost).not.toHaveBeenCalled()
  })

  it('does not loop when a retried request already carries the retry flag', async () => {
    const error = unauthorized()
    error.config._retry = true

    await expect(responseErrorInterceptor(error)).rejects.toBe(error)
    expect(mocks.axiosPost).not.toHaveBeenCalled()
  })

  it('refreshes once, writes the token back through the auth store and retries the original request', async () => {
    attachAuth('expired-token')
    mocks.axiosPost.mockResolvedValue({ data: { token: 'fresh-token' } })
    mocks.instance.mockResolvedValue({ data: 'retried-response' })
    const error = unauthorized()

    const result = await responseErrorInterceptor(error)

    expect(mocks.axiosPost).toHaveBeenCalledWith('/api/auth/refresh', {}, { withCredentials: true })
    // 内存中的 store 被更新（persist 同步 localStorage），不会被旧 token 回写覆盖
    expect(useAuthStore.getState().token).toBe('fresh-token')
    const persisted = JSON.parse(localStorage.getItem('cyber-sister-auth'))
    expect(persisted.state.token).toBe('fresh-token')
    expect(error.config._retry).toBe(true)
    expect(error.config.headers.Authorization).toBe('Bearer fresh-token')
    expect(mocks.instance).toHaveBeenCalledWith(error.config)
    expect(result).toEqual({ data: 'retried-response' })
  })

  it('queues concurrent 401s behind the in-flight refresh and retries all of them', async () => {
    attachAuth('expired-token')
    let resolveRefresh
    mocks.axiosPost.mockImplementation(() => new Promise((resolve) => { resolveRefresh = resolve }))
    mocks.instance.mockResolvedValue({ data: 'retried-response' })

    const first = unauthorized({ config: { url: '/first', headers: {} } })
    const second = unauthorized({ config: { url: '/second', headers: {} } })

    const firstPromise = responseErrorInterceptor(first)
    const secondPromise = responseErrorInterceptor(second)

    // 第二次 401 进入等待队列，不会触发第二次刷新
    expect(mocks.axiosPost).toHaveBeenCalledTimes(1)
    expect(mocks.instance).not.toHaveBeenCalled()

    resolveRefresh({ data: { token: 'fresh-token' } })

    await expect(firstPromise).resolves.toEqual({ data: 'retried-response' })
    await expect(secondPromise).resolves.toEqual({ data: 'retried-response' })
    expect(second.config.headers.Authorization).toBe('Bearer fresh-token')
    expect(mocks.instance).toHaveBeenCalledTimes(2)
  })

  it('rejects queued requests and clears the persisted session when refresh fails', async () => {
    attachAuth('expired-token')
    const refreshFailure = new Error('refresh rejected')
    let rejectRefresh
    mocks.axiosPost.mockImplementation(() => new Promise((_, reject) => { rejectRefresh = reject }))
    mocks.instance.mockResolvedValue({ data: 'should-not-happen' })

    const first = unauthorized({ config: { url: '/first', headers: {} } })
    const second = unauthorized({ config: { url: '/second', headers: {} } })

    const firstPromise = responseErrorInterceptor(first)
    const secondPromise = responseErrorInterceptor(second)
    rejectRefresh(refreshFailure)

    await expect(firstPromise).rejects.toBe(refreshFailure)
    await expect(secondPromise).rejects.toBe(refreshFailure)
    expect(localStorage.getItem('cyber-sister-auth')).toBeNull()
    expect(mocks.instance).not.toHaveBeenCalled()
  })

  it('still retries when there is no persisted session to update', async () => {
    useAuthStore.setState({ token: null, user: null, isLoggedIn: false })
    mocks.axiosPost.mockResolvedValue({ data: { token: 'fresh-token' } })
    mocks.instance.mockResolvedValue({ data: 'retried-response' })
    const error = unauthorized()

    const result = await responseErrorInterceptor(error)

    expect(result).toEqual({ data: 'retried-response' })
    expect(error.config.headers.Authorization).toBe('Bearer fresh-token')
  })

  it('treats a refresh response without a token as a failure', async () => {
    attachAuth('expired-token')
    mocks.axiosPost.mockResolvedValue({ data: {} })
    const error = unauthorized()

    await expect(responseErrorInterceptor(error)).rejects.toThrow('刷新响应缺少访问令牌')

    expect(localStorage.getItem('cyber-sister-auth')).toBeNull()
    expect(mocks.instance).not.toHaveBeenCalled()
  })

  it('marks queued requests as retried so a replayed 401 rejects instead of looping', async () => {
    attachAuth('expired-token')
    mocks.axiosPost.mockResolvedValue({ data: { token: 'fresh-token' } })
    // 重放时服务端仍回 401：走拦截器，因 _retry 标记直接拒绝
    mocks.instance.mockImplementation((config) =>
      Promise.reject({ config, response: { status: 401 } }).catch(responseErrorInterceptor))

    const first = unauthorized({ config: { url: '/first', headers: {} } })
    const second = unauthorized({ config: { url: '/second', headers: {} } })

    const firstPromise = responseErrorInterceptor(first)
    const secondPromise = responseErrorInterceptor(second)

    await expect(firstPromise).rejects.toMatchObject({ response: { status: 401 } })
    await expect(secondPromise).rejects.toMatchObject({ response: { status: 401 } })
    // 只刷新了一次，没有循环
    expect(mocks.axiosPost).toHaveBeenCalledTimes(1)
    expect(second.config._retry).toBe(true)
  })
})

describe('api module', () => {
  it('exposes the shared axios instance', () => {
    expect(api).toBe(mocks.instance)
  })
})
