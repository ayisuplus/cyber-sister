import api from './api'

export const authService = {
  sendCode: (phone) => api.post('/auth/send-code', { phone }),
  login: (phone, code) => api.post('/auth/login', { phone, code }),
  // refreshToken 现在通过 httpOnly cookie 自动携带，无需传参
  refresh: () => api.post('/auth/refresh'),
  logout: () => api.post('/auth/logout'),
}
