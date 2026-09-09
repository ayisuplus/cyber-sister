/**
 * 聊天图片消息服务：照片落盘 data/chat-images/<userId>/<messageId><ext>（tmp+rename 原子写），
 * 行内只记 Message.imageExt。历史图片不重送模型，仅在渲染气泡时按需读取。
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'

const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}
const EXT_TO_MIME = Object.fromEntries(Object.entries(MIME_TO_EXT).map(([mime, ext]) => [ext, mime]))
const PROBE_EXTS = ['.jpg', '.png', '.webp']

// 与 userAssetService 相同的用户目录名净化：杜绝路径穿越
const sanitizeUserSegment = (userId) => String(userId ?? '').replace(/[^a-zA-Z0-9-]/g, '_')

function chatImageRootDir(env) {
  return env.CHAT_IMAGE_DIR || fileURLToPath(new URL('../../data/chat-images', import.meta.url))
}

export async function saveChatImage(userId, messageId, { buffer, mime }, env = process.env) {
  const ext = MIME_TO_EXT[mime]
  if (!ext) throw new HttpError('仅支持 JPEG/PNG/WebP 图片', 400)
  const dir = join(chatImageRootDir(env), sanitizeUserSegment(userId))
  await mkdir(dir, { recursive: true })
  // tmp + rename 原子落盘：并发 GET 不会读到截断图片
  const tmpPath = join(dir, `${messageId}${ext}.${randomUUID()}.tmp`)
  await writeFile(tmpPath, buffer)
  await rename(tmpPath, join(dir, `${messageId}${ext}`))
  return ext
}

export async function readChatImage(userId, messageId, ext, env = process.env) {
  const mime = EXT_TO_MIME[ext]
  if (!mime) throw new HttpError('图片不存在', 404)
  const buffer = await readFile(
    join(chatImageRootDir(env), sanitizeUserSegment(userId), `${messageId}${ext}`),
  ).catch(() => null)
  if (!buffer) throw new HttpError('图片不存在', 404)
  return { buffer, mime }
}

export async function deleteChatImages(userId, messageIds, env = process.env) {
  const dir = join(chatImageRootDir(env), sanitizeUserSegment(userId))
  // 幂等：行已删/文件缺失都静默带过
  await Promise.all(
    messageIds.flatMap((id) => PROBE_EXTS.map((ext) => rm(join(dir, `${id}${ext}`), { force: true }))),
  )
  logger.info('聊天图片清理', { userId, count: messageIds.length })
}
