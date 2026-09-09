/**
 * 3D 衣柜服务：单品行落库（wardrobe_items），文件落盘
 * data/wardrobe/<userId>/<itemId>/source<ext> + model.glb（tmp+rename 原子写）。
 * 图生 3D 由 imageTo3dService 承担；未配置时 createItem 在落任何数据前抛 503。
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import prisma from '../prisma/client.js'
import { findOwned, deleteOwned, HttpError } from '../utils/dbHelpers.js'
import { generateModel } from './imageTo3dService.js'
import logger from '../utils/logger.js'

const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}
const EXT_TO_MIME = Object.fromEntries(Object.entries(MIME_TO_EXT).map(([mime, ext]) => [ext, mime]))
const MODEL_EXT = '.glb'
const MODEL_MIME = 'model/gltf-binary'

// 与 userAssetService 相同的用户目录名净化：杜绝路径穿越
const sanitizeUserSegment = (userId) => String(userId ?? '').replace(/[^a-zA-Z0-9-]/g, '_')

function wardrobeRootDir(env) {
  return env.WARDROBE_DIR || fileURLToPath(new URL('../../data/wardrobe', import.meta.url))
}

function itemDir(root, userId, itemId) {
  return join(root, sanitizeUserSegment(userId), itemId)
}

function toClient(item) {
  return {
    id: item.id,
    name: item.name,
    createdAt: item.createdAt,
    sourceUrl: `/api/wardrobe/${item.id}/source`,
    modelUrl: `/api/wardrobe/${item.id}/model`,
  }
}

export async function listItems(userId) {
  const items = await prisma.wardrobeItem.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
  return items.map(toClient)
}

export async function createItem(userId, { name, buffer, mime }, env = process.env) {
  const sourceExt = MIME_TO_EXT[mime]
  if (!sourceExt) throw new HttpError('仅支持 JPEG/PNG/WebP 图片', 400)
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (trimmed.length > 30) throw new HttpError('单品名字最多 30 个字', 400)
  // 先走外部 3D 生成：未配置/失败时抛错，不落行也不写文件
  const { modelBuffer } = await generateModel({ buffer, mime }, env)
  const item = await prisma.wardrobeItem.create({
    data: { userId, name: trimmed || '未命名单品', sourceExt, modelExt: MODEL_EXT },
  })
  const dir = itemDir(wardrobeRootDir(env), userId, item.id)
  try {
    await mkdir(dir, { recursive: true })
    // tmp + rename 原子落盘：并发 GET 不会读到截断文件
    const writeAtomic = async (fileName, data) => {
      const tmpPath = join(dir, `${fileName}.${randomUUID()}.tmp`)
      await writeFile(tmpPath, data)
      await rename(tmpPath, join(dir, fileName))
    }
    await Promise.all([
      writeAtomic(`source${sourceExt}`, buffer),
      writeAtomic(`model${MODEL_EXT}`, modelBuffer),
    ])
  } catch (error) {
    // 写盘失败回补删行，不留无文件幽灵行
    await prisma.wardrobeItem.delete({ where: { id: item.id } }).catch(() => {})
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  logger.info('创建衣柜单品', { userId, itemId: item.id })
  return toClient(item)
}

export async function readItemFile(userId, itemId, kind, env = process.env) {
  if (kind !== 'source' && kind !== 'model') throw new HttpError('不支持的文件类型', 400)
  const item = await findOwned('wardrobeItem', itemId, userId, '单品')
  const dir = itemDir(wardrobeRootDir(env), userId, item.id)
  if (kind === 'model') {
    const buffer = await readFile(join(dir, `model${MODEL_EXT}`)).catch(() => null)
    if (!buffer) throw new HttpError('模型文件不存在', 404)
    return { buffer, mime: MODEL_MIME }
  }
  const buffer = await readFile(join(dir, `source${item.sourceExt}`)).catch(() => null)
  if (!buffer) throw new HttpError('图片文件不存在', 404)
  return { buffer, mime: EXT_TO_MIME[item.sourceExt] }
}

export async function deleteItem(userId, itemId, env = process.env) {
  await deleteOwned('wardrobeItem', itemId, userId, '单品')
  await rm(itemDir(wardrobeRootDir(env), userId, itemId), { recursive: true, force: true })
  logger.info('删除衣柜单品', { userId, itemId })
}
