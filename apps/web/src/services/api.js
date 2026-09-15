import axios from 'axios'
import { assertSessionVersion, getSessionVersion, resetSession } from './sessionLifecycle'

/** @typedef {import('axios').InternalAxiosRequestConfig & { _sessionVersion?: number }} SessionRequestConfig */

export const API_TIMEOUT_MS = 75_000

// 默认同源 /api（Docker/Nginx 反代）；部署到 Cloudflare Pages 等独立静态托管时，
// 构建期注入 VITE_API_BASE_URL（如 https://api.example.com/api），API 侧需同步放开 CORS_ORIGIN
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT_MS,
  withCredentials: true,  // 携带 httpOnly cookie（refresh token）
  headers: { 'Content-Type': 'application/json' },
})

// 读取持久化的访问令牌；数据损坏时清除后按无会话处理。
// axios 请求拦截器与 SSE 流式请求（chatService.streamMessage）共用。
export const getPersistedToken = () => {
  const authData = localStorage.getItem('cyber-sister-auth')
  if (!authData) return null
  try {
    const { state } = JSON.parse(authData)
    return state?.token || null
  } catch {
    // localStorage 数据损坏，清除后静默重试
    localStorage.removeItem('cyber-sister-auth')
    return null
  }
}

// 刷新单飞：并发的 401（含 SSE 流式请求）共享同一次刷新。
// 失败时执行既有退出语义：清登录态并回到登录页。
let refreshPromise = null
let refreshVersion = null
let authOperation = Promise.resolve()

// 身份操作包含 HTTP 与状态提交，串行化以防迟到 Set-Cookie 覆盖新的登录。
export const runAuthOperation = (operation) => {
  const pending = authOperation.then(operation)
  authOperation = pending.catch(() => {})
  return pending
}

export const refreshAccessToken = (session = getSessionVersion()) => {
  assertSessionVersion(session)
  if (!refreshPromise || refreshVersion !== session) {
    refreshVersion = session
    refreshPromise = runAuthOperation(async () => {
      try {
        assertSessionVersion(session)
        // refreshToken 现在通过 httpOnly cookie 自动携带，无需手动传
        const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {}, { withCredentials: true, timeout: API_TIMEOUT_MS })
        assertSessionVersion(session)

        const { token } = response.data
        if (!token) {
          throw new Error('刷新响应缺少访问令牌')
        }

        // 通过 store 写回新 token（persist 同步 localStorage），
        // 避免只写 localStorage 后被内存中的旧 token 回写覆盖。
        // 动态 import 打破 authStore → authService → api 的循环依赖。
        const { useAuthStore } = await import('../stores/authStore')
        assertSessionVersion(session)
        useAuthStore.setState({ token })

        return token
      } catch (refreshError) {
        // 刷新失败，清除登录状态
        if (session === getSessionVersion()) {
          resetSession()
          localStorage.removeItem('cyber-sister-auth')
          // 由订阅登录态的路由切回登录页，避免整页导航中断已排队的手动登录。
        }

        throw refreshError
      } finally {
        if (refreshVersion === session) refreshPromise = null
      }
    })
  }
  return refreshPromise
}

// 同步捕获调用时的会话与 JWT，避免微任务中切换账号后才给旧请求绑定新身份。
api.interceptors.request.use(/** @param {SessionRequestConfig} config */ (config) => {
  config._sessionVersion ??= getSessionVersion()
  assertSessionVersion(config._sessionVersion)
  const token = getPersistedToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  } else {
    delete config.headers.Authorization
  }
  return config
}, undefined, { synchronous: true })

// 响应拦截器 - 处理Token过期
api.interceptors.response.use(
  (response) => {
    const config = /** @type {SessionRequestConfig} */ (response.config)
    if (config?._sessionVersion !== undefined) assertSessionVersion(config._sessionVersion)
    return response
  },
  async (error) => {
    const originalRequest = error.config
    const session = originalRequest?._sessionVersion ?? getSessionVersion()
    assertSessionVersion(session)

    // 如果是401错误且不是刷新Token的请求
    const isAuthRequest = ['/auth/login', '/auth/refresh', '/auth/logout'].some((path) => originalRequest?.url?.includes(path))
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !isAuthRequest) {
      // 重放前打上重试标记：若仍 401 则由拦截器直接拒绝，不再循环刷新
      originalRequest._retry = true

      // 并发 401 共享同一次刷新；刷新失败时 refreshAccessToken 内部已执行退出语义
      const token = await refreshAccessToken(session)
      assertSessionVersion(session)
      originalRequest.headers.Authorization = `Bearer ${token}`
      return api(originalRequest)
    }

    return Promise.reject(error)
  }
)

export default api
