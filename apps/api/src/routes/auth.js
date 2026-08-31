import { Router } from 'express'
import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import prisma from '../prisma/client.js'
import { validatePhone, validateCode, validate } from '../utils/validate.js'
import logger from '../utils/logger.js'
import {
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  REFRESH_TOKEN_AGE_MS,
} from '../middleware/auth.js'

const router = Router()
const APP_ENV = process.env.APP_ENV || 'development'
const IS_INTERNAL = APP_ENV === 'internal'
const INTERNAL_CODE = process.env.INTERNAL_TEST_CODE || ''
const ALLOWED_PHONES = new Set(
  (process.env.INTERNAL_TEST_PHONES || '')
    .split(',')
    .map((phone) => phone.trim())
    .filter(Boolean),
)

const MAX_LOGIN_ATTEMPTS = 5
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000
const LOCKOUT_DURATION_MS = 30 * 60 * 1000
// 只按手机号哈希计数：共享 6 位内测码下，按 IP 计数可被换 IP 绕过
const MAX_TRACKED_ATTEMPTS = 10000
export const loginAttempts = new Map()

class RefreshTokenRejectedError extends Error {}

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_INTERNAL || process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/auth',
  maxAge: REFRESH_TOKEN_AGE_MS,
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function constantTimeCodeEquals(input, expected) {
  if (typeof input !== 'string' || typeof expected !== 'string') return false
  const inputDigest = crypto.createHash('sha256').update(input).digest()
  const expectedDigest = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(inputDigest, expectedDigest)
}

function attemptKey(phone) {
  return crypto.createHash('sha256').update(phone).digest('hex').slice(0, 16)
}

function getAttempt(key) {
  const attempt = loginAttempts.get(key)
  if (!attempt) return null
  const now = Date.now()
  if ((attempt.lockedUntil && attempt.lockedUntil > now) || attempt.windowEndsAt > now) return attempt
  loginAttempts.delete(key)
  return null
}
// 有界容量：插入前超出上限时清扫过期项，防止计数表无限增长
export function sweepLoginAttempts(now = Date.now()) {
  for (const [key, attempt] of loginAttempts) {
    const expired = (!attempt.lockedUntil || attempt.lockedUntil <= now)
      && attempt.windowEndsAt <= now
    if (expired) loginAttempts.delete(key)
  }
}

function recordFailedAttempt(key) {
  const previous = getAttempt(key)
  const failures = (previous?.failures || 0) + 1
  const attempt = {
    failures,
    windowEndsAt: previous?.windowEndsAt || Date.now() + ATTEMPT_WINDOW_MS,
    lockedUntil: failures >= MAX_LOGIN_ATTEMPTS ? Date.now() + LOCKOUT_DURATION_MS : null,
  }
  loginAttempts.set(key, attempt)
  if (loginAttempts.size > MAX_TRACKED_ATTEMPTS) sweepLoginAttempts()
  return attempt
}

function invalidCredentials(res, key) {
  const attempt = recordFailedAttempt(key)
  if (attempt.failures >= MAX_LOGIN_ATTEMPTS) {
    return res.status(429).json({ error: '登录尝试次数过多，请稍后再试' })
  }
  return res.status(401).json({ error: '手机号或验证码错误' })
}

function storeRefreshToken(client, userId, rawToken) {
  return client.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_AGE_MS),
    },
  })
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
  const key = attemptKey(phone)
  const previous = getAttempt(key)
  if (previous?.lockedUntil && previous.lockedUntil > Date.now()) {
    return res.status(429).json({ error: '登录尝试次数过多，请稍后再试' })
  }

  if (!IS_INTERNAL || !ALLOWED_PHONES.has(phone) || !constantTimeCodeEquals(code, INTERNAL_CODE)) {
    logger.warn('内测登录校验失败', { ip: req.ip })
    return invalidCredentials(res, key)
  }

  try {
    let user = await prisma.user.findUnique({ where: { phone } })
    if (!user) {
      try {
        user = await prisma.user.create({
          data: { phone, nickname: '内测用户', persona: 'toxic' },
        })
        logger.info('新内测用户注册', { userId: user.id })
      } catch (error) {
        // 并发注册同一手机号：唯一约束冲突后回读已创建的用户，继续签发 token
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          user = await prisma.user.findUnique({ where: { phone } })
        }
        if (!user) throw error
      }
    }

    const token = generateToken({ userId: user.id, phone: user.phone })
    // jti 保证同一秒内签发的多个 refresh token 也具有不同哈希。
    const refreshToken = generateRefreshToken({ userId: user.id, jti: crypto.randomUUID() })
    await storeRefreshToken(prisma, user.id, refreshToken)
    loginAttempts.delete(key)

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

  const tokenHash = hashToken(rawToken)
  let newRefreshToken
  let token

  try {
    await prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.updateMany({
        where: {
          tokenHash,
          userId: decoded.userId,
          revoked: false,
          expiresAt: { gt: new Date() },
        },
        data: { revoked: true },
      })
      if (revoked.count !== 1) throw new RefreshTokenRejectedError()

      const user = await tx.user.findUnique({ where: { id: decoded.userId } })
      if (!user) throw new RefreshTokenRejectedError()
      // 白名单复核：手机号被移出内测名单后，撤销该用户全部未过期 refresh token
      if (IS_INTERNAL && !ALLOWED_PHONES.has(user.phone)) {
        await tx.refreshToken.updateMany({
          where: { userId: user.id, revoked: false, expiresAt: { gt: new Date() } },
          data: { revoked: true },
        })
        throw new RefreshTokenRejectedError()
      }

      newRefreshToken = generateRefreshToken({ userId: user.id, jti: crypto.randomUUID() })
      await storeRefreshToken(tx, user.id, newRefreshToken)
      token = generateToken({ userId: user.id, phone: user.phone })
    })
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

  res.cookie('refreshToken', newRefreshToken, REFRESH_COOKIE_OPTIONS)
  return res.json({ token })
})

router.post('/logout', async (req, res) => {
  const rawToken = req.cookies?.refreshToken
  if (rawToken) {
    try {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(rawToken), revoked: false },
        data: { revoked: true },
      })
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
