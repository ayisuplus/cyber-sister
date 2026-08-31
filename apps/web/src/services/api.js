import axios from 'axios'

export const API_TIMEOUT_MS = 75_000

const api = axios.create({
  baseURL: '/api',
  timeout: API_TIMEOUT_MS,
  withCredentials: true,  // 携带 httpOnly cookie（refresh token）
  headers: { 'Content-Type': 'application/json' },
})

// 是否正在刷新Token
let isRefreshing = false
let failedQueue = []

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error)
    } else {
      prom.resolve(token)
    }
  })
  failedQueue = []
}

// 请求拦截器 - 添加JWT
api.interceptors.request.use((config) => {
  const authData = localStorage.getItem('cyber-sister-auth')
  if (authData) {
    try {
      const { state } = JSON.parse(authData)
      if (state?.token) {
        config.headers.Authorization = `Bearer ${state.token}`
      }
    } catch {
      // localStorage 数据损坏，清除后静默重试
      localStorage.removeItem('cyber-sister-auth')
    }
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
      if (isRefreshing) {
        // 如果正在刷新Token，将请求加入队列
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        })
          .then((token) => {
            // 重放前打上重试标记：若仍 401 则由拦截器直接拒绝，不再循环刷新
            originalRequest._retry = true
            originalRequest.headers.Authorization = `Bearer ${token}`
            return api(originalRequest)
          })
          .catch((err) => Promise.reject(err))
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        // refreshToken 现在通过 httpOnly cookie 自动携带，无需手动传
        const response = await axios.post('/api/auth/refresh', {}, { withCredentials: true })

        const { token } = response.data
        if (!token) {
          throw new Error('刷新响应缺少访问令牌')
        }

        // 通过 store 写回新 token（persist 同步 localStorage），
        // 避免只写 localStorage 后被内存中的旧 token 回写覆盖。
        // 动态 import 打破 authStore → authService → api 的循环依赖。
        const { useAuthStore } = await import('../stores/authStore')
        useAuthStore.setState({ token })

        processQueue(null, token)

        originalRequest.headers.Authorization = `Bearer ${token}`
        return api(originalRequest)
      } catch (refreshError) {
        processQueue(refreshError, null)

        // 刷新失败，清除登录状态
        localStorage.removeItem('cyber-sister-auth')

        // 重新加载页面以重置状态
        window.location.href = '/login'

        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    return Promise.reject(error)
  }
)

export default api
