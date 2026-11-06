import api, { refreshAccessToken, sendMobileAuth } from './api'
import { isIOSApp } from '../platform/native'
import { saveMobileSession, logoutMobileSession } from '../platform/mobileSession'
import { getSessionVersion } from './sessionLifecycle'

export const authService = {
  requestCode: (phone) => sendMobileAuth('/auth/mobile/request-code', { phone }),
  login: async (phone, code) => {
    const session = getSessionVersion()
    if (isIOSApp()) return saveMobileSession(await sendMobileAuth('/auth/mobile/login', { phone, code }), session)
    const response = await api.post('/auth/login', { phone, code })
    return response.data
  },
  // refreshToken 现在通过 httpOnly cookie 自动携带，无需传参
  refresh: async () => {
    return { token: await refreshAccessToken() }
  },
  logout: async () => {
    if (isIOSApp()) return logoutMobileSession(sendMobileAuth)
    const response = await api.post('/auth/logout')
    return response.data
  },
  updatePersona: async (persona) => {
    const response = await api.put('/user/persona', { persona })
    return response.data
  },
}
