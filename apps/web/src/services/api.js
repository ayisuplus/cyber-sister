import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
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
    } catch (e) {
      // localStorage 数据损坏，清除后静默重试
      console.warn('[API] 读取 auth 数据失败，已清除:', e.message)
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
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // 如果正在刷新Token，将请求加入队列
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        })
          .then((token) => {
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

        // 更新 localStorage 中的 access token
        const authData = localStorage.getItem('cyber-sister-auth')
        if (authData) {
          const { state } = JSON.parse(authData)
          const newState = { ...state, token }
          localStorage.setItem(
            'cyber-sister-auth',
            JSON.stringify({ state: newState })
          )
        }

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
