import axios from 'axios'

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

export const refreshAccessToken = () => {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        // refreshToken 现在通过 httpOnly cookie 自动携带，无需手动传
        const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {}, { withCredentials: true })

        const { token } = response.data
        if (!token) {
          throw new Error('刷新响应缺少访问令牌')
        }

        // 通过 store 写回新 token（persist 同步 localStorage），
        // 避免只写 localStorage 后被内存中的旧 token 回写覆盖。
        // 动态 import 打破 authStore → authService → api 的循环依赖。
        const { useAuthStore } = await import('../stores/authStore')
        useAuthStore.setState({ token })

        return token
      } catch (refreshError) {
        // 刷新失败，清除登录状态
        localStorage.removeItem('cyber-sister-auth')

        // 重新加载页面以重置状态
        window.location.href = '/login'

        throw refreshError
      } finally {
        refreshPromise = null
      }
    })()
  }
  return refreshPromise
}

// 请求拦截器 - 添加JWT
api.interceptors.request.use((config) => {
  const token = getPersistedToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截器 - 处理Token过期
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    // 如果是401错误且不是刷新Token的请求
    const isAuthRequest = originalRequest?.url?.includes('/auth/login') || originalRequest?.url?.includes('/auth/refresh')
    if (error.response?.status === 401 && !originalRequest._retry && !isAuthRequest) {
      // 重放前打上重试标记：若仍 401 则由拦截器直接拒绝，不再循环刷新
      originalRequest._retry = true

      // 并发 401 共享同一次刷新；刷新失败时 refreshAccessToken 内部已执行退出语义
      const token = await refreshAccessToken()
      originalRequest.headers.Authorization = `Bearer ${token}`
      return api(originalRequest)
    }

    return Promise.reject(error)
  }
)

export default api
