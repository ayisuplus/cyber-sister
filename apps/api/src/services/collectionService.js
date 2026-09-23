/**
 * 「装扮」里的收藏：衣柜与化妆间共用一张表（collection_items）。
 * 照片存在 data/collection/<userId>/<itemId>.jpg 与 <itemId>.thumb.jpg（先写临时文件再改名；写失败就把刚建的行删掉），
 * 行内只记 imageExt。只收 JPEG，存之前再去一遍拍摄信息。链接只存不打开：服务器从不访问它。
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import prisma from '../prisma/client.js'
import { findOwned, HttpError } from '../utils/dbHelpers.js'
import { stripJpegMetadata } from '../utils/jpegMetadata.js'
import logger from '../utils/logger.js'

export const CATEGORIES = {
  wardrobe: ['上衣', '下装', '连衣裙', '外套', '鞋', '包', '配饰'],
  makeup: ['底妆', '眼妆', '唇妆', '护肤', '香水', '工具'],
}
export const SHELVES = Object.keys(CATEGORIES)
export const STATUSES = ['want', 'have']
export const MAX_COLLECTION_ITEMS = 500
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024
export const MAX_THUMB_BYTES = 512 * 1024
// 她读收藏时最多看这么多件，免得一次塞满上下文
export const MAX_ITEMS_FOR_HER = 60
const MAX_NAME = 40
const MAX_NOTE = 300
const MAX_LINK = 2000
const PHOTO_EXT = '.jpg'
const SHELF_LABELS = { wardrobe: '衣柜', makeup: '化妆间' }

// 与 chatImageService 相同的用户目录名净化：杜绝路径穿越
const sanitizeUserSegment = (userId) => String(userId ?? '').replace(/[^a-zA-Z0-9-]/g, '_')
const collectionRootDir = (env) => env.COLLECTION_DIR || fileURLToPath(new URL('../../data/collection', import.meta.url))
const userDir = (env, userId) => join(collectionRootDir(env), sanitizeUserSegment(userId))
const fileName = (itemId, kind) => `${itemId}${kind === 'thumb' ? '.thumb' : ''}${PHOTO_EXT}`

const text = (value) => (typeof value === 'string' ? value.trim() : '')

function toClient(item) {
  const version = new Date(item.updatedAt).getTime()
  const photo = (kind) => (item.imageExt ? `/api/collection/${item.id}/${kind}?v=${version}` : null)
  return {
    id: item.id,
    shelf: item.shelf,
    category: item.category ?? null,
    name: item.name,
    note: item.note ?? null,
    status: item.status,
    link: item.link ?? null,
    photoUrl: photo('photo'),
    thumbUrl: photo('thumb'),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

function checkShelf(shelf) {
  if (!SHELVES.includes(shelf)) throw new HttpError('只能放进衣柜或化妆间', 400)
  return shelf
}

function checkName(value) {
  const name = text(value)
  if (!name) throw new HttpError('给它起个名字吧', 400)
  if (name.length > MAX_NAME) throw new HttpError(`名字最多 ${MAX_NAME} 个字`, 400)
  return name
}

function checkCategory(value, shelf) {
  const category = text(value)
  if (!category) return null
  if (!CATEGORIES[shelf].includes(category)) throw new HttpError('没有这个分类', 400)
  return category
}

function checkNote(value) {
  const note = text(value)
  if (note.length > MAX_NOTE) throw new HttpError(`备注最多 ${MAX_NOTE} 个字`, 400)
  return note || null
}

function checkStatus(value) {
  if (!STATUSES.includes(value)) throw new HttpError('只能标成「想要」或「已有」', 400)
  return value
}

/** 只收 http(s) 链接；存下来原样给你点开，服务器不访问。 */
function checkLink(value) {
  const link = text(value)
  if (!link) return null
  let url
  try { url = new URL(link) } catch { throw new HttpError('这不是一个能打开的链接', 400) }
  if (!['http:', 'https:'].includes(url.protocol) || link.length > MAX_LINK) throw new HttpError('这不是一个能打开的链接', 400)
  return url.toString()
}

// 只校验传了的字段：新建时名字、柜子必填，改的时候没传就不动
const FIELD_CHECKS = {
  name: (value) => checkName(value),
  category: (value, shelf) => checkCategory(value, shelf),
  note: (value) => checkNote(value),
  status: (value) => checkStatus(value),
  link: (value) => checkLink(value),
}

function normalizeFields(fields = {}, shelf) {
  const data = {}
  for (const [key, check] of Object.entries(FIELD_CHECKS)) {
    if (fields[key] !== undefined) data[key] = check(fields[key], shelf)
  }
  return data
}

/** 照片和缩略图要一起来；都去掉拍摄信息。没有照片时返回 null。 */
function preparePhotos(files = {}) {
  const photo = files.photo?.[0]?.buffer
  const thumb = files.thumb?.[0]?.buffer
  if (!photo && !thumb) return null
  if (!photo || !thumb) throw new HttpError('照片和缩略图要一起上传', 400)
  if (photo.length > MAX_PHOTO_BYTES || thumb.length > MAX_THUMB_BYTES) throw new HttpError('这张照片太大了，请换一张', 400)
  return { photo: stripJpegMetadata(photo), thumb: stripJpegMetadata(thumb) }
}

async function writePhotos(env, userId, itemId, images) {
  const dir = userDir(env, userId)
  await mkdir(dir, { recursive: true })
  // 先写临时文件再改名：同时在读的请求不会读到半张图
  await Promise.all(['photo', 'thumb'].map(async (kind) => {
    const target = join(dir, fileName(itemId, kind))
    const tmpPath = `${target}.${randomUUID()}.tmp`
    await writeFile(tmpPath, images[kind])
    await rename(tmpPath, target)
  }))
}

const removePhotos = (env, userId, itemId) => Promise.all(
  ['photo', 'thumb'].map((kind) => rm(join(userDir(env, userId), fileName(itemId, kind)), { force: true })),
)

/** 某个柜子里的收藏，新的在前；不传柜子就是全部。 */
export async function listItems(userId, shelf) {
  const items = await prisma.collectionItem.findMany({
    where: { userId, ...(shelf ? { shelf: checkShelf(shelf) } : {}) },
    orderBy: { createdAt: 'desc' },
    take: MAX_COLLECTION_ITEMS,
  })
  return items.map(toClient)
}

export async function createItem(userId, fields = {}, files = {}, env = process.env) {
  const shelf = checkShelf(fields.shelf)
  const data = { name: checkName(fields.name), status: 'have', ...normalizeFields(fields, shelf) }
  const images = preparePhotos(files)
  const count = await prisma.collectionItem.count({ where: { userId } })
  if (count >= MAX_COLLECTION_ITEMS) throw new HttpError(`收藏已经满 ${MAX_COLLECTION_ITEMS} 件了，删掉一些再放吧`, 400)
  const item = await prisma.collectionItem.create({ data: { userId, shelf, ...data, imageExt: images ? PHOTO_EXT : null } })
  if (images) {
    try {
      await writePhotos(env, userId, item.id, images)
    } catch (error) {
      // 写盘失败就把行删掉，不留有行没图的空记录
      await prisma.collectionItem.delete({ where: { id: item.id } }).catch(() => {})
      await removePhotos(env, userId, item.id).catch(() => {})
      throw error
    }
  }
  logger.info('收藏一件', { userId, shelf, withPhoto: Boolean(images) })
  return toClient(item)
}

/** 改文字，也可以换照片；柜子不能换。 */
export async function updateItem(userId, itemId, fields = {}, files = {}, env = process.env) {
  const existing = await findOwned('collectionItem', itemId, userId, '这件收藏')
  const data = normalizeFields(fields, existing.shelf)
  const images = preparePhotos(files)
  if (images) await writePhotos(env, userId, existing.id, images)
  const item = await prisma.collectionItem.update({
    where: { id: existing.id },
    data: { ...data, ...(images ? { imageExt: PHOTO_EXT } : {}) },
  })
  return toClient(item)
}

export async function deleteItem(userId, itemId, env = process.env) {
  const existing = await findOwned('collectionItem', itemId, userId, '这件收藏')
  await prisma.collectionItem.delete({ where: { id: existing.id } })
  await removePhotos(env, userId, existing.id)
  logger.info('删掉一件收藏', { userId })
}

/** 读一件收藏的照片或缩略图：归属校验在前，文件不在就 404。 */
export async function readPhoto(userId, itemId, kind, env = process.env) {
  const item = await findOwned('collectionItem', itemId, userId, '这件收藏')
  if (!item.imageExt) throw new HttpError('这件收藏没有照片', 404)
  const buffer = await readFile(join(userDir(env, userId), fileName(item.id, kind === 'thumb' ? 'thumb' : 'photo'))).catch(() => null)
  if (!buffer) throw new HttpError('照片不在了', 404)
  return { buffer, mime: 'image/jpeg' }
}

/**
 * 给她看的收藏：只有名字、柜子、分类、想要/已有和备注，不含照片和链接。
 * @param {{ shelf?: string, status?: string, category?: string }} [filter]
 */
export async function listForHer(userId, { shelf = 'all', status = 'all', category } = {}) {
  const where = {
    userId,
    ...(shelf && shelf !== 'all' ? { shelf: checkShelf(shelf) } : {}),
    ...(status && status !== 'all' ? { status: checkStatus(status) } : {}),
    ...(text(category) ? { category: text(category) } : {}),
  }
  const [total, items] = await Promise.all([
    prisma.collectionItem.count({ where }),
    prisma.collectionItem.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: MAX_ITEMS_FOR_HER,
      select: { name: true, shelf: true, category: true, status: true, note: true },
    }),
  ])
  return {
    total,
    items: items.map((item) => ({
      name: item.name,
      shelf: SHELF_LABELS[item.shelf] ?? item.shelf,
      category: item.category ?? null,
      status: item.status === 'want' ? '想要' : '已有',
      note: item.note ?? null,
    })),
  }
}
