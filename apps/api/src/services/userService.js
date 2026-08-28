/**
 * 用户服务
 * 封装用户信息、人格切换、会员管理的业务逻辑
 */
import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'
import { cacheGet, cacheSet, cacheDel } from '../utils/redis.js'

const CACHE_TTL = 300  // 用户信息缓存 5 分钟
const cacheKey = (userId) => `user:profile:${userId}`

/**
 * 获取用户信息（脱敏返回，缓存 5 分钟）
 */
export async function getProfile(userId) {
  // 先查缓存
  const cached = await cacheGet(cacheKey(userId))
  if (cached) return cached

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      phone: true,
      nickname: true,
      persona: true,
      isVip: true,
      vipExpireAt: true,
      avatarUrl: true,
      birthDate: true,
      createdAt: true,
    },
  })
  if (!user) {
    throw new HttpError('用户不存在', 404)
  }

  // 写入缓存
  await cacheSet(cacheKey(userId), user, CACHE_TTL)
  return user
}

/**
 * 更新用户信息
 */
export async function updateProfile(userId, { nickname, avatarUrl, birthDate }) {
  const updateData = {}
  if (nickname !== undefined) {
    if (typeof nickname !== 'string' || nickname.length > 50) {
      throw new HttpError('昵称不能超过50个字符', 400)
    }
    updateData.nickname = nickname.trim()
  }
  if (avatarUrl !== undefined) {
    if (typeof avatarUrl === 'string' && avatarUrl.length > 500) {
      throw new HttpError('头像地址过长', 400)
    }
    updateData.avatarUrl = avatarUrl || null
  }
  if (birthDate !== undefined) {
    updateData.birthDate = birthDate ? new Date(birthDate) : null
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: {
      id: true, phone: true, nickname: true, persona: true,
      isVip: true, vipExpireAt: true, avatarUrl: true, birthDate: true,
    },
  })

  logger.info('用户信息更新', { userId })
  // 失效缓存
  await cacheDel(cacheKey(userId))
  return user
}

/**
 * 切换人格
 */
export async function switchPersona(userId, persona) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { persona },
    select: { persona: true },
  })
  logger.info('人格切换', { userId, persona })
  // 失效缓存
  await cacheDel(cacheKey(userId))
  return user
}

/**
 * 获取会员状态
 */
export async function getMembership(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isVip: true, vipExpireAt: true },
  })
  return {
    isVip: user?.isVip || false,
    vipExpireAt: user?.vipExpireAt || null,
  }
}

/**
 * 开通会员（Mock 实现，30天）
 */
export async function subscribeMembership(userId) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      isVip: true,
      vipExpireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    select: { isVip: true, vipExpireAt: true },
  })
  logger.info('会员开通', { userId })
  // 失效缓存
  await cacheDel(cacheKey(userId))
  return { success: true, ...user }
}
