import api, { refreshAccessToken } from './api'

export const authService = {
  login: async (phone, code) => {
    const response = await api.post('/auth/login', { phone, code })
    return response.data
  },
  // refreshToken 现在通过 httpOnly cookie 自动携带，无需传参
  refresh: async () => {
    return { token: await refreshAccessToken() }
  },
  logout: async () => {
    const response = await api.post('/auth/logout')
    return response.data
  },
  updatePersona: async (persona) => {
    const response = await api.put('/user/persona', { persona })
    return response.data
  },
}
