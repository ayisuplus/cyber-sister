/**
 * 花草图鉴（路线图 C26）：她收进图鉴的花草，一张表（plant_entries）。
 * 照片存在 data/garden/<userId>/<entryId>.jpg 与 .thumb.jpg（照片存储见 utils/photoStore.js；写失败就把刚建的行删掉）。
 * 识别那一步不存照片：只有她点了「收进图鉴」才落盘。识别结果随收藏一起带回来，服务器按同一份形状再校验一遍。
 */
import { fileURLToPath } from 'node:url'
import prisma from '../prisma/client.js'
import { findOwned, HttpError } from '../utils/dbHelpers.js'
import { createPhotoStore, PHOTO_EXT, preparePhotoPair } from '../utils/photoStore.js'
import { clip, normalizeIdentification } from './plantIdentification.js'
import { groundIdentification, loadPlantReference } from './plantReference.js'
import logger from '../utils/logger.js'

export const STATUSES = ['met', 'grow']
export const STATUS_LABELS = { met: '路上遇见', grow: '我养的' }
export const MAX_PLANT_ENTRIES = 1000
// 她读图鉴时最多看这么多条，免得一次塞满上下文
export const MAX_ENTRIES_FOR_HER = 60
const MAX_NAME = 40
const MAX_SCIENTIFIC_NAME = 80
const MAX_FAMILY = 40
const MAX_NOTE = 300
const ENTRY_LABEL = '这株花草'

const photos = createPhotoStore((env) => env.GARDEN_DIR || fileURLToPath(new URL('../../data/garden', import.meta.url)))

const text = (value) => (typeof value === 'string' ? value.trim() : '')

function toClient(entry) {
  const version = new Date(entry.updatedAt).getTime()
  const photo = (kind) => (entry.imageExt ? `/api/garden/${entry.id}/${kind}?v=${version}` : null)
  return {
    id: entry.id,
    name: entry.name,
    scientificName: entry.scientificName ?? null,
    family: entry.family ?? null,
    status: entry.status,
    note: entry.note ?? null,
    candidates: Array.isArray(entry.candidates) ? entry.candidates : [],
    explanation: entry.explanation ?? null,
    caution: entry.caution ?? null,
    reference: entry.reference ?? null,
    identified: Boolean(entry.promptVersion),
    photoUrl: photo('photo'),
    thumbUrl: photo('thumb'),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

function checkName(value) {
  const name = text(value)
  if (!name) throw new HttpError('给它写个名字吧', 400)
  if (name.length > MAX_NAME) throw new HttpError(`名字最多 ${MAX_NAME} 个字`, 400)
  return name
}

function checkOptional(label, max) {
  return (value) => {
    const cleaned = text(value)
    if (cleaned.length > max) throw new HttpError(`${label}最多 ${max} 个字`, 400)
    return cleaned || null
  }
}

function checkStatus(value) {
  if (!STATUSES.includes(value)) throw new HttpError('只能标成「路上遇见」或「我养的」', 400)
  return value
}

// 只校验传了的字段：新建时名字必填，改的时候没传就不动
const FIELD_CHECKS = {
  name: checkName,
  scientificName: checkOptional('学名', MAX_SCIENTIFIC_NAME),
  family: checkOptional('科', MAX_FAMILY),
  status: checkStatus,
  note: checkOptional('备注', MAX_NOTE),
}

function normalizeFields(fields = {}) {
  const data = {}
  for (const [key, check] of Object.entries(FIELD_CHECKS)) {
    if (fields[key] !== undefined) data[key] = check(fields[key])
  }
  return data
}

/**
 * 收藏时带回来的识别结果（multipart 里是一段 JSON）。讲解是照第一个候选写的，
 * 所以只有她选的就是第一个候选（pick = 0）时才留讲解；换了候选或自己写名字，只留候选和提醒。
 * 名录与毒性的核对不信前端带回来的：按候选在本机资料里重核一遍再存。
 */
function identificationData(fields, env) {
  if (fields.identification === undefined || fields.identification === '') return {}
  let raw
  try {
    raw = typeof fields.identification === 'string' ? JSON.parse(fields.identification) : fields.identification
  } catch {
    throw new HttpError('识别结果读不出来，请重新认一次', 400)
  }
  const result = normalizeIdentification(raw)
  if (!result?.isPlant) throw new HttpError('识别结果读不出来，请重新认一次', 400)
  const pickedFirst = String(fields.pick ?? '') === '0'
  return {
    candidates: result.candidates,
    reference: groundIdentification(result, loadPlantReference(env)).reference,
    explanation: pickedFirst ? result.explanation : null,
    caution: result.caution,
    promptVersion: result.promptVersion,
    identifiedBy: result.identifiedBy,
  }
}

/** 图鉴里的全部花草，新的在前；可以只看路上遇见的或我养的。 */
export async function listEntries(userId, status) {
  const entries = await prisma.plantEntry.findMany({
    where: { userId, ...(status ? { status: checkStatus(status) } : {}) },
    orderBy: { createdAt: 'desc' },
    take: MAX_PLANT_ENTRIES,
  })
  return entries.map(toClient)
}

export async function createEntry(userId, fields = {}, files = {}, env = process.env) {
  const data = { name: checkName(fields.name), status: 'met', ...normalizeFields(fields), ...identificationData(fields, env) }
  const images = preparePhotoPair(files)
  const count = await prisma.plantEntry.count({ where: { userId } })
  if (count >= MAX_PLANT_ENTRIES) throw new HttpError(`图鉴已经满 ${MAX_PLANT_ENTRIES} 株了，删掉一些再收吧`, 400)
  const entry = await prisma.plantEntry.create({ data: { userId, ...data, imageExt: images ? PHOTO_EXT : null } })
  if (images) {
    try {
      await photos.write(env, userId, entry.id, images)
    } catch (error) {
      // 写盘失败就把行删掉，不留有行没图的空记录
      await prisma.plantEntry.delete({ where: { id: entry.id } }).catch(() => {})
      await photos.remove(env, userId, entry.id).catch(() => {})
      throw error
    }
  }
  logger.info('收进图鉴一株', { userId, withPhoto: Boolean(images), identified: Boolean(data.promptVersion) })
  return toClient(entry)
}

/** 改名字、学名、科、遇见/养着和备注，也可以换照片；识别结果不改。 */
export async function updateEntry(userId, entryId, fields = {}, files = {}, env = process.env) {
  const existing = await findOwned('plantEntry', entryId, userId, ENTRY_LABEL)
  const data = normalizeFields(fields)
  const images = preparePhotoPair(files)
  if (images) await photos.write(env, userId, existing.id, images)
  const entry = await prisma.plantEntry.update({
    where: { id: existing.id },
    data: { ...data, ...(images ? { imageExt: PHOTO_EXT } : {}) },
  })
  return toClient(entry)
}

export async function deleteEntry(userId, entryId, env = process.env) {
  const existing = await findOwned('plantEntry', entryId, userId, ENTRY_LABEL)
  await prisma.plantEntry.delete({ where: { id: existing.id } })
  await photos.remove(env, userId, existing.id)
  logger.info('从图鉴里拿掉一株', { userId })
}

/** 读一株的照片或缩略图：归属校验在前，文件不在就 404。 */
export async function readPhoto(userId, entryId, kind, env = process.env) {
  const entry = await findOwned('plantEntry', entryId, userId, ENTRY_LABEL)
  if (!entry.imageExt) throw new HttpError('这株没有照片', 404)
  const buffer = await photos.read(env, userId, entry.id, kind)
  if (!buffer) throw new HttpError('照片不在了', 404)
  return { buffer, mime: 'image/jpeg' }
}

const beijingDate = (value) => new Date(new Date(value).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)

/**
 * 给她看的图鉴：名字、科、遇见/养着、哪天收的和备注，不含照片、讲解和识别细节。
 * @param {{ status?: string, keyword?: string }} [filter]
 */
export async function listForHer(userId, { status = 'all', keyword } = {}) {
  const word = clip(keyword, MAX_NAME)
  const where = {
    userId,
    ...(status && status !== 'all' ? { status: checkStatus(status) } : {}),
    ...(word ? { OR: [{ name: { contains: word } }, { family: { contains: word } }, { note: { contains: word } }] } : {}),
  }
  const [total, names, entries] = await Promise.all([
    prisma.plantEntry.count({ where }),
    prisma.plantEntry.findMany({ where, distinct: ['name'], select: { name: true } }),
    prisma.plantEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: MAX_ENTRIES_FOR_HER,
      select: { name: true, family: true, status: true, note: true, createdAt: true },
    }),
  ])
  return {
    total,
    kinds: names.length,
    items: entries.map((entry) => ({
      name: entry.name,
      family: entry.family ?? null,
      status: STATUS_LABELS[entry.status] ?? entry.status,
      date: beijingDate(entry.createdAt),
      note: entry.note ?? null,
    })),
  }
}
