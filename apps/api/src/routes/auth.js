import { Router } from 'express'
import { validatePhone, validateCode, validate } from '../utils/validate.js'
import logger from '../utils/logger.js'
import { verifyRefreshToken, REFRESH_TOKEN_AGE_MS } from '../middleware/auth.js'
import {
  IS_INTERNAL,
  RefreshTokenRejectedError,
  clearLoginAttempts,
  findOrCreateInternalUser,
  getLoginAttempt,
  isLoginLocked,
  issueSession,
  recordLoginFailure,
  revokeRefreshToken,
  rotateRefreshToken,
  verifyInternalCredentials,
} from '../services/authService.js'

const router = Router()

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_INTERNAL || process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/auth',
  maxAge: REFRESH_TOKEN_AGE_MS,
}

function rejectRefreshToken(res) {
  res.clearCookie('refreshToken', { path: '/api/auth' })
  return res.status(401).json({ error: 'RefreshToken无效，请重新登录' })
}

router.post('/login', validate([
  { field: 'phone', validate: validatePhone },
  { field: 'code', validate: validateCode },
]), async (req, res) => {
  const { phone, code } = req.body
  if (isLoginLocked(getLoginAttempt(phone))) {
    return res.status(429).json({ error: '登录尝试次数过多，请稍后再试' })
  }

  if (!verifyInternalCredentials(phone, code)) {
    logger.warn('内测登录校验失败', { ip: req.ip })
    const attempt = recordLoginFailure(phone)
    if (attempt.lockedUntil) {
      return res.status(429).json({ error: '登录尝试次数过多，请稍后再试' })
    }
    return res.status(401).json({ error: '手机号或验证码错误' })
  }

  try {
    const user = await findOrCreateInternalUser(phone)
    const { token, refreshToken } = await issueSession(user)
    clearLoginAttempts(phone)

    res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS)
    return res.json({
      token,
      user: {
        id: user.id,
        phone: user.phone,
        nickname: user.nickname,
        persona: user.persona,
        isVip: user.isVip,
        avatarUrl: user.avatarUrl,
        roleName: user.roleName,
        roleSetting: user.roleSetting,
      },
    })
  } catch (error) {
    logger.error('登录失败', { error: error.message })
    return res.status(500).json({ error: '登录失败，请稍后重试' })
  }
})

router.post('/refresh', async (req, res) => {
  const rawToken = req.cookies?.refreshToken
  if (!rawToken) {
    return res.status(401).json({ error: 'RefreshToken无效，请重新登录' })
  }

  let decoded
  try {
    decoded = verifyRefreshToken(rawToken)
    if (typeof decoded.userId !== 'string' || !decoded.userId) {
      throw new RefreshTokenRejectedError()
    }
  } catch {
    logger.warn('Token刷新失败', { result: 'refresh_invalid' })
    return rejectRefreshToken(res)
  }

  let rotated
  try {
    rotated = await rotateRefreshToken(rawToken, decoded.userId)
  } catch (error) {
    if (error instanceof RefreshTokenRejectedError) {
      logger.warn('Token刷新失败', { result: 'refresh_invalid' })
      return rejectRefreshToken(res)
    }

    logger.error('Token刷新依赖不可用', { result: 'refresh_unavailable' })
    return res.status(503).json({
      error: '刷新服务暂时不可用，请稍后重试',
      code: 'REFRESH_UNAVAILABLE',
    })
  }

  res.cookie('refreshToken', rotated.newRefreshToken, REFRESH_COOKIE_OPTIONS)
  return res.json({ token: rotated.token })
})

router.post('/logout', async (req, res) => {
  const rawToken = req.cookies?.refreshToken
  if (rawToken) {
    try {
      await revokeRefreshToken(rawToken)
    } catch (error) {
      logger.warn('撤销 refresh token 失败', { error: error.message })
      return res.status(503).json({
        error: '退出服务暂时不可用，请稍后重试',
        code: 'LOGOUT_UNAVAILABLE',
      })
    }
  }

  res.clearCookie('refreshToken', { path: '/api/auth' })
  return res.json({ success: true })
})

export default router
