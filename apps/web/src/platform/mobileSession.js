import { SessionVault } from './native'
import { assertSessionVersion, getSessionVersion, onSessionReset } from '../services/sessionLifecycle'

let accessToken = null
export const getMobileAccessToken = () => accessToken
export const setMobileAccessToken = (token) => { accessToken = token }
onSessionReset(() => { accessToken = null })

export async function clearMobileSession() {
  accessToken = null
  await SessionVault.clear()
}

export async function saveMobileSession(result, session = getSessionVersion()) {
  assertSessionVersion(session)
  if (!result?.token || !result?.refreshToken || !result?.user?.id) throw new Error('登录响应不完整')
  await SessionVault.write({ value: result.refreshToken })
  assertSessionVersion(session)
  accessToken = result.token
  return result
}

export async function refreshMobileSession(send) {
  const session = getSessionVersion()
  const { value } = await SessionVault.read()
  assertSessionVersion(session)
  if (!value) throw Object.assign(new Error('请先登录'), { response: { status: 401 } })
  try {
    return await saveMobileSession(await send('/auth/mobile/refresh', { refreshToken: value }), session)
  } catch (error) {
    if (session === getSessionVersion() && error.response?.status === 401) await clearMobileSession()
    throw error
  }
}

export async function logoutMobileSession(send) {
  const { value } = await SessionVault.read()
  if (value) await send('/auth/mobile/logout', { refreshToken: value })
  await clearMobileSession()
}
