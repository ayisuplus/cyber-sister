import { Router } from 'express'
import { validate, validatePhone, validateCode } from '../utils/validate.js'
import { verifyRefreshToken } from '../middleware/auth.js'
import {
  findOrCreateInternalUser, issueSession, rotateRefreshToken, revokeRefreshToken,
  RefreshTokenRejectedError, isAllowedPhone, getLoginAttempt, isLoginLocked,
  recordLoginFailure, clearLoginAttempts,
} from '../services/authService.js'
import { unavailableLoginCodes } from '../services/mobileLoginCodes.js'

const publicUser = ({ id, phone, nickname, persona, isVip, avatarUrl }) => ({ id, phone, nickname, persona, isVip, avatarUrl })

export function createMobileAuthRouter({ codes = unavailableLoginCodes } = {}) {
  const router = Router()
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store')
    // 原生 URLSession 不带 Origin；WKWebView 只能来自打包的受信页面。
    if (req.get('origin') && req.get('origin') !== 'capacitor://localhost') {
      return res.status(403).json({ error: '客户端来源不允许' })
    }
    next()
  })
  const run = (handler) => async (req, res) => {
    try { await handler(req, res) } catch (error) {
      if (error instanceof RefreshTokenRejectedError) return res.status(401).json({ error: '登录状态已失效' })
      const status = error.status === 429 ? 429 : 503
      return res.status(status).json({ error: status === 429 ? '请稍后重试' : '登录服务暂不可用', code: error.code === 'SMS_UNAVAILABLE' ? error.code : 'AUTH_UNAVAILABLE' })
    }
  }
  router.post('/request-code', validate([{ field: 'phone', validate: validatePhone }]), run(async (req, res) => {
    res.json(await codes.request(req.body.phone))
  }))
  router.post('/login', validate([
    { field: 'phone', validate: validatePhone }, { field: 'code', validate: validateCode },
  ]), run(async (req, res) => {
    const { phone, code } = req.body
    if (isLoginLocked(getLoginAttempt(phone))) return res.status(429).json({ error: '请稍后重试' })
    const valid = await codes.consume(phone, code)
    if (!valid || !isAllowedPhone(phone)) {
      recordLoginFailure(phone)
      return res.status(401).json({ error: '手机号或验证码错误' })
    }
    const user = await findOrCreateInternalUser(phone)
    const session = await issueSession(user)
    clearLoginAttempts(phone)
    res.json({ ...session, user: publicUser(user) })
  }))
  router.post('/refresh', run(async (req, res) => {
    const raw = req.body?.refreshToken
    let decoded
    try {
      if (typeof raw !== 'string' || raw.length > 4096) throw new Error('invalid')
      decoded = verifyRefreshToken(raw)
      if (typeof decoded.userId !== 'string') throw new Error('invalid')
    } catch { return res.status(401).json({ error: '登录状态已失效' }) }
    const result = await rotateRefreshToken(raw, decoded.userId, { requireWhitelist: true })
    res.json({ token: result.token, refreshToken: result.newRefreshToken, user: publicUser(result.user) })
  }))
  router.post('/logout', run(async (req, res) => {
    const raw = req.body?.refreshToken
    if (typeof raw !== 'string' || raw.length > 4096) return res.status(400).json({ error: '缺少会话凭据' })
    await revokeRefreshToken(raw)
    res.json({ success: true })
  }))
  return router
}

export default createMobileAuthRouter()
