import { Router } from 'express'
import crypto from 'crypto'
import prisma from '../prisma/client.js'
import { validatePhone, validateCode, validate } from '../utils/validate.js'
import logger from '../utils/logger.js'
import { generateToken, generateRefreshToken, verifyRefreshToken, REFRESH_TOKEN_AGE_MS } from '../middleware/auth.js'
import { cacheIncr, cacheGet, cacheDel } from '../utils/redis.js'

const router = Router()

// Mock 验证码配置：仅开发环境使用，生产环境拒绝
const MOCK_CODE = process.env.MOCK_VERIFICATION_CODE || '888888'
const isProduction = process.env.NODE_ENV === 'production'

// 防暴力破解配置
const MAX_LOGIN_ATTEMPTS = 5       // 最大尝试次数
const LOCKOUT_DURATION = 30 * 60    // 锁定时间（秒）
const ATTEMPT_TTL = 900             // 失败计数过期时间（15 分钟）

// Refresh Token Cookie 配置
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,       // JS 无法访问，防 XSS 窃取
  secure: isProduction, // 生产环境仅 HTTPS
  sameSite: 'lax',       // 防止 CSRF
  path: '/api/auth',     // 仅 /api/auth 路径携带
  maxAge: REFRESH_TOKEN_AGE_MS,
}

/**
 * 对 refresh token 做 SHA-256 哈希后存入数据库（不存明文）
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * 存储 refresh token 到数据库
 */
function storeRefreshToken(userId, rawToken) {
  const tokenHash = hashToken(rawToken)
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_AGE_MS)
  return prisma.refreshToken.create({
    data: { userId, tokenHash, expiresAt },
  })
}

/**
 * 验证并撤销数据库中的 refresh token
 */
async function validateAndRevokeRefreshToken(rawToken) {
  if (!rawToken) return false
  const tokenHash = hashToken(rawToken)
  const stored = await prisma.refreshToken.findFirst({
    where: { tokenHash, revoked: false, expiresAt: { gt: new Date() } },
  })
  if (!stored) return false
  // 标记为已撤销（防止重复使用）
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revoked: true },
  })
  return stored
}

// 发送验证码（开发环境 Mock，生产环境需对接真实短信服务）
router.post('/send-code', validate([
  { field: 'phone', validate: validatePhone },
]), (req, res) => {
  const { phone } = req.body

  if (isProduction) {
    // TODO: 对接真实短信服务（阿里云/腾讯云短信）
    return res.status(501).json({ error: '短信服务未配置' })
  }

  logger.warn('⚠️ 开发环境：使用 Mock 验证码发送', { phone, mockCode: MOCK_CODE })
  res.json({ success: true, message: '验证码已发送' })
})

// 验证码登录
router.post('/login', validate([
  { field: 'phone', validate: validatePhone },
  { field: 'code', validate: validateCode },
]), async (req, res) => {
  try {
    const { phone, code } = req.body

    // 检查是否被锁定
    const attempts = await cacheGet(`login_attempts:${phone}`)
    if (attempts && attempts >= MAX_LOGIN_ATTEMPTS) {
      logger.warn('账户登录被锁定', { phone, attempts })
      return res.status(429).json({
        error: `登录尝试次数过多，请 ${LOCKOUT_DURATION / 60} 分钟后再试`,
      })
    }

    // 生产环境拒绝 Mock 验证码
    if (isProduction && code === MOCK_CODE) {
      logger.error('🚨 生产环境检测到 Mock 验证码使用！', { phone })
      await cacheIncr(`login_attempts:${phone}`, ATTEMPT_TTL)
      return res.status(400).json({ error: '验证码错误' })
    }

    // 验证码校验（开发环境：Mock code 或任意 6 位数字）
    if (code !== MOCK_CODE) {
      await cacheIncr(`login_attempts:${phone}`, ATTEMPT_TTL)
      return res.status(400).json({ error: '验证码错误' })
    }

    if (!isProduction) {
      logger.warn('⚠️ 开发环境：Mock 验证码登录', { phone })
    }

    // 查找或创建用户
    let user = await prisma.user.findUnique({
      where: { phone },
    })

    if (!user) {
      user = await prisma.user.create({
        data: {
          phone,
          nickname: '小仙女',
          persona: 'toxic',
        },
      })
      logger.info('新用户注册', { userId: user.id, phone })
    }

    const token = generateToken({ userId: user.id, phone: user.phone })
    const refreshToken = generateRefreshToken({ userId: user.id })

    // 登录成功，重置失败计数
    await cacheDel(`login_attempts:${phone}`)

    // 将 refresh token 哈希存入数据库
    await storeRefreshToken(user.id, refreshToken)

    logger.info('用户登录成功', { userId: user.id, phone })

    // refreshToken 设为 httpOnly cookie（防 XSS），access token 返回 body
    res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS)

    res.json({
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
    res.status(500).json({ error: '登录失败，请稍后重试' })
  }
})

// 刷新Token（从 httpOnly cookie 读取 refreshToken）
router.post('/refresh', async (req, res) => {
  try {
    // 优先从 cookie 读取，兼容旧版 body 方式
    const rawToken = req.cookies?.refreshToken || req.body?.refreshToken
    if (!rawToken) {
      return res.status(400).json({ error: '缺少refreshToken' })
    }

    // 先验证 JWT 签名
    const decoded = verifyRefreshToken(rawToken)

    // 验证数据库中的 token（防重放攻击：一次使用即撤销）
    const stored = await validateAndRevokeRefreshToken(rawToken)
    if (!stored) {
      return res.status(401).json({ error: 'RefreshToken已失效，请重新登录' })
    }

    // 验证用户是否存在
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    })
    if (!user) {
      return res.status(401).json({ error: '用户不存在' })
    }

    // 生成新的 token pair
    const newToken = generateToken({ userId: user.id, phone: user.phone })
    const newRefreshToken = generateRefreshToken({ userId: user.id })
    await storeRefreshToken(user.id, newRefreshToken)

    // 设置新的 httpOnly cookie
    res.cookie('refreshToken', newRefreshToken, REFRESH_COOKIE_OPTIONS)

    res.json({ token: newToken })
  } catch (error) {
    logger.warn('Token刷新失败', { error: error.message })
    res.clearCookie('refreshToken', { path: '/api/auth' })
    res.status(401).json({ error: 'RefreshToken已过期，请重新登录' })
  }
})

// 退出登录（清除 cookie + 撤销所有 refresh token）
router.post('/logout', async (req, res) => {
  try {
    // 撤销该用户所有未过期的 refresh token
    const userId = req.user?.userId
    if (userId) {
      await prisma.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      })
      logger.info('用户退出登录，已撤销所有 refresh token', { userId })
    }
  } catch (error) {
    logger.warn('撤销 refresh token 失败', { error: error.message })
  }

  res.clearCookie('refreshToken', { path: '/api/auth' })
  res.json({ success: true })
})

export default router
