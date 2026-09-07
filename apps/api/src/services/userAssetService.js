/**
 * 用户形象资产服务：头像 / 主页背景 / 聊天背景三个固定槽位。
 * 文件落在 data/user-assets/<userId>/<slot>.<ext>；存在即生效（404 即未设置），不落库。
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'

export const ASSET_SLOTS = new Set(['avatar', 'bg-home', 'bg-chat'])

const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}
const EXT_TO_MIME = Object.fromEntries(Object.entries(MIME_TO_EXT).map(([mime, ext]) => [ext, mime]))
const PROBE_EXTS = ['.jpg', '.png', '.webp']

// 与 workImageService 相同的用户目录名净化：杜绝路径穿越
const sanitizeUserSegment = (userId) => String(userId ?? '').replace(/[^a-zA-Z0-9-]/g, '_')

function assetRootDir(env) {
  return env.USER_ASSET_DIR || fileURLToPath(new URL('../../data/user-assets', import.meta.url))
}

function assertSlot(slot) {
  if (!ASSET_SLOTS.has(slot)) throw new HttpError('不支持的形象槽位', 400)
}

/**
 * 保存槽位图片；换格式覆盖时删除同槽位其它扩展名的旧文件，不留双份。
 * @returns {Promise<{ url: string }>} url 带 ?v= 时间戳，仅作客户端缓存破坏，服务端忽略
 */
export async function saveAsset(userId, slot, { buffer, mime }, env = process.env) {
  assertSlot(slot)
  const ext = MIME_TO_EXT[mime]
  if (!ext) throw new HttpError('仅支持 JPEG/PNG/WebP 图片', 400)
  const userDir = join(assetRootDir(env), sanitizeUserSegment(userId))
  await mkdir(userDir, { recursive: true })
  // tmp + rename 原子落盘：并发 GET 不会读到截断图片；崩溃残留的 .tmp 会被下方 leftover 清理捎走
  const tmpPath = join(userDir, `${slot}${ext}.${randomUUID()}.tmp`)
  await writeFile(tmpPath, buffer)
  await rename(tmpPath, join(userDir, `${slot}${ext}`))
  const leftovers = (await readdir(userDir))
    .filter((name) => name.startsWith(`${slot}.`) && name !== `${slot}${ext}`)
  await Promise.all(leftovers.map((name) => rm(join(userDir, name), { force: true })))
  logger.info('用户资产更新', { userId, action: slot })
  return { url: `/api/user/assets/${slot}?v=${Date.now()}` }
}

/** 三种扩展名并行探测，按 .jpg/.png/.webp 优先级取命中；都不在 → 404 未设置。 */
export async function readAsset(userId, slot, env = process.env) {
  assertSlot(slot)
  const userDir = join(assetRootDir(env), sanitizeUserSegment(userId))
  const hits = await Promise.all(PROBE_EXTS.map(async (ext) => {
    const buffer = await readFile(join(userDir, `${slot}${ext}`)).catch(() => null)
    return buffer ? { buffer, mime: EXT_TO_MIME[ext] } : null
  }))
  const hit = hits.find(Boolean)
  if (!hit) throw new HttpError('未设置', 404)
  return hit
}

/** 删除槽位全部扩展名文件；不存在也成功（幂等）。 */
export async function deleteAsset(userId, slot, env = process.env) {
  assertSlot(slot)
  const userDir = join(assetRootDir(env), sanitizeUserSegment(userId))
  await Promise.all(PROBE_EXTS.map((ext) => rm(join(userDir, `${slot}${ext}`), { force: true })))
  logger.info('用户资产更新', { userId, action: slot })
}
