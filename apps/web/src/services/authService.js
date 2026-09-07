import api from './api'

export const authService = {
  login: async (phone, code) => {
    const response = await api.post('/auth/login', { phone, code })
    return response.data
  },
  // refreshToken 现在通过 httpOnly cookie 自动携带，无需传参
  refresh: async () => {
    const response = await api.post('/auth/refresh')
    return response.data
  },
  logout: async () => {
    const response = await api.post('/auth/logout')
    return response.data
  },
  updatePersona: async (persona) => {
    const response = await api.put('/user/persona', { persona })
    return response.data
  },
  updateRolePlay: async (data) => {
    const response = await api.put('/user/roleplay', data)
    return response.data
  },
  clearRolePlay: async () => {
    const response = await api.delete('/user/roleplay')
    return response.data
  },
}
