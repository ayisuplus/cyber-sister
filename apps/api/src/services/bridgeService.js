/**
 * 本机助手的配对与身份：设置页生成一次性连接码，用户电脑上的助手用它换一个长期令牌。
 * 连接码与令牌都只存 SHA-256 哈希；领取用条件更新，同一个码并发领取只有一个成功。
 */
import { createHash, randomBytes, randomInt } from 'node:crypto'
import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'
import { disconnectBridge, isBridgeConnected } from './bridgeBroker.js'

// 去掉 0/O/1/I，念出来、抄下来都不容易错
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8
const PAIRING_TTL_MS = 10 * 60 * 1000
export const MAX_BRIDGES = 3
const LAST_SEEN_WRITE_INTERVAL_MS = 60 * 1000

export const hashSecret = (value) => createHash('sha256').update(String(value)).digest('hex')
const normalizeCode = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const newCode = () => Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')

export async function createPairing(userId, now = new Date()) {
  const connected = await prisma.localBridge.count({ where: { userId, revokedAt: null, tokenHash: { not: null } } })
  if (connected >= MAX_BRIDGES) throw new HttpError(`最多连接 ${MAX_BRIDGES} 台电脑，请先断开一台`, 409)
  // 同一个用户只保留一个未使用的连接码
  await prisma.localBridge.deleteMany({ where: { userId, tokenHash: null, revokedAt: null } })
  const code = newCode()
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS)
  await prisma.localBridge.create({ data: { userId, pairingCodeHash: hashSecret(code), pairingExpiresAt: expiresAt } })
  logger.info('生成本机助手连接码', { userId })
  return { code, expiresAt }
}

export async function claimPairing({ code, name } = {}, now = new Date()) {
  const normalized = normalizeCode(code)
  if (normalized.length !== CODE_LENGTH) throw new HttpError('连接码不对，请核对后再试', 400)
  const label = typeof name === 'string' && name.trim() ? name.trim().slice(0, 40) : '我的电脑'
  const token = randomBytes(32).toString('base64url')
  const claimed = await prisma.localBridge.updateMany({
    where: { pairingCodeHash: hashSecret(normalized), tokenHash: null, revokedAt: null, pairingExpiresAt: { gt: now } },
    data: { tokenHash: hashSecret(token), pairingCodeHash: null, pairingExpiresAt: null, name: label, lastSeenAt: now },
  })
  if (claimed.count !== 1) throw new HttpError('连接码无效或已过期，请在「设置 → 连接你的电脑」里重新生成', 400)
  const bridge = await prisma.localBridge.findUnique({ where: { tokenHash: hashSecret(token) }, select: { id: true, userId: true, name: true } })
  logger.info('本机助手已连接', { userId: bridge.userId, bridgeId: bridge.id })
  return { token, bridgeId: bridge.id, name: bridge.name }
}

export async function listBridges(userId) {
  const rows = await prisma.localBridge.findMany({
    where: { userId, revokedAt: null, tokenHash: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, createdAt: true, lastSeenAt: true },
  })
  return rows.map((row) => ({ ...row, online: isBridgeConnected(row.id) }))
}

export async function revokeBridge(userId, bridgeId) {
  const revoked = await prisma.localBridge.updateMany({
    where: { id: bridgeId, userId, revokedAt: null, tokenHash: { not: null } },
    data: { revokedAt: new Date(), tokenHash: null },
  })
  if (revoked.count === 0) throw new HttpError('这台电脑不存在或已断开', 404)
  disconnectBridge(bridgeId)
  logger.info('断开本机助手', { userId, bridgeId })
  return { success: true }
}

/** 助手请求的身份：Authorization: Bridge <令牌>。已断开的令牌一律无效。 */
export function authenticateBridge(token) {
  if (typeof token !== 'string' || token.length < 32) return Promise.resolve(null)
  return prisma.localBridge.findFirst({
    where: { tokenHash: hashSecret(token), revokedAt: null },
    select: { id: true, userId: true, name: true, lastSeenAt: true },
  })
}

/** 「上次在线」只给设置页看，最多一分钟写一次库。 */
export async function touchBridge(bridge, now = new Date()) {
  if (bridge.lastSeenAt && now.getTime() - bridge.lastSeenAt.getTime() < LAST_SEEN_WRITE_INTERVAL_MS) return
  await prisma.localBridge.updateMany({ where: { id: bridge.id, revokedAt: null }, data: { lastSeenAt: now } })
}
