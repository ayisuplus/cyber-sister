/**
 * 认证服务：内测凭证校验、登录锁定计数、用户注册与 refresh token 生命周期。
 *
 * routes/auth.js 只做参数校验、cookie 读写与 HTTP 状态映射；
 * 数据库访问与锁定计数全部集中在这里。
 */
import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import prisma from '../prisma/client.js'
import logger from '../utils/logger.js'
import {
  generateToken,
  generateRefreshToken,
  REFRESH_TOKEN_AGE_MS,
} from '../middleware/auth.js'

const APP_ENV = process.env.APP_ENV || 'development'
export const IS_INTERNAL = APP_ENV === 'internal'
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
// 进程内单例：锁定计数只在当前进程内有效
export const loginAttempts = new Map()

export class RefreshTokenRejectedError extends Error {}

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

/** 读取某手机号的当前尝试记录（过期项顺手清除） */
export function getLoginAttempt(phone) {
  return getAttempt(attemptKey(phone))
}

/** 判断是否处于锁定期 */
export function isLoginLocked(attempt) {
  return Boolean(attempt?.lockedUntil && attempt.lockedUntil > Date.now())
}

/** 记录一次失败登录，返回最新尝试记录（lockedUntil 非空即达到上限） */
export function recordLoginFailure(phone) {
  return recordFailedAttempt(attemptKey(phone))
}

/** 登录成功后清除该手机号的失败计数 */
export function clearLoginAttempts(phone) {
  loginAttempts.delete(attemptKey(phone))
}

/** 内测凭证校验：环境开关 + 手机号白名单 + 固定内测码（常数时间比较） */
export function verifyInternalCredentials(phone, code) {
  return IS_INTERNAL && ALLOWED_PHONES.has(phone) && constantTimeCodeEquals(code, INTERNAL_CODE)
}

/** 按手机号查找或注册内测用户；并发注册撞唯一约束时回读已创建的用户 */
export async function findOrCreateInternalUser(phone) {
  let user = await prisma.user.findUnique({ where: { phone } })
  if (user) return user
  try {
    user = await prisma.user.create({
      data: { phone, nickname: '内测用户', persona: 'toxic' },
    })
    logger.info('新内测用户注册', { userId: user.id })
    return user
  } catch (error) {
    // 并发注册同一手机号：唯一约束冲突后回读已创建的用户，继续签发 token
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      user = await prisma.user.findUnique({ where: { phone } })
    }
    if (!user) throw error
    return user
  }
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

/** 登录成功后签发 access + refresh token 并持久化 refresh token */
export async function issueSession(user) {
  const token = generateToken({ userId: user.id, phone: user.phone })
  // jti 保证同一秒内签发的多个 refresh token 也具有不同哈希。
  const refreshToken = generateRefreshToken({ userId: user.id, jti: crypto.randomUUID() })
  await storeRefreshToken(prisma, user.id, refreshToken)
  return { token, refreshToken }
}

/**
 * 原子轮换 refresh token：旧 token 必须未撤销且未过期，
 * 手机号被移出内测白名单时撤销该用户全部未过期会话。
 * 轮换被拒绝抛 RefreshTokenRejectedError，数据库故障原样上抛。
 */
export async function rotateRefreshToken(rawToken, userId) {
  const tokenHash = hashToken(rawToken)
  let newRefreshToken
  let token

  await prisma.$transaction(async (tx) => {
    const revoked = await tx.refreshToken.updateMany({
      where: {
        tokenHash,
        userId,
        revoked: false,
        expiresAt: { gt: new Date() },
      },
      data: { revoked: true },
    })
    if (revoked.count !== 1) throw new RefreshTokenRejectedError()

    const user = await tx.user.findUnique({ where: { id: userId } })
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

  return { token, newRefreshToken }
}

/** 撤销指定 refresh token（幂等）；数据库故障原样上抛 */
export function revokeRefreshToken(rawToken) {
  return prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(rawToken), revoked: false },
    data: { revoked: true },
  })
}
