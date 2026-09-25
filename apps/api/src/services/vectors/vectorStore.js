/**
 * 派生索引的读写（路线图 C23，见 docs/architecture/非对称记忆架构.md）：
 * 记忆与她上传的书的段落，向量都存在 embeddings 一张表，这里是唯一的读写入口。
 *
 * - 一行 = 一个对象在一个模型下的向量：identityKey 管「是不是同一个模型、同一种算法」，
 *   subjectVersion 管「算的是不是现在这段文字」；两样都对得上才拿来比。
 * - 向量写入前归一化（Float64），比较时两边只差一个缩放，余弦不变。
 * - 只是派生物：可丢弃、可重算、不导出。对象被删或文字变了，旧向量随之删除。
 */
import prisma from '../../prisma/client.js'
import { contentVersion, identityKeyOf } from './identity.js'

/** 归一化成普通数组（Float64）；零向量返回 null。 */
function normalized(vector) {
  let norm = 0
  for (const value of vector) norm += value * value
  norm = Math.sqrt(norm)
  return norm && Number.isFinite(norm) ? vector.map((value) => value / norm) : null
}

/**
 * 组一行：text 是拿去算向量的那段文字（只用来算版本，不存）；identity 是算它的模型身份（embeddingConfig()）。
 * 返回 null 表示这个向量不能存（身份不全或零向量）。
 */
export function embeddingRow({ userId, subjectType, subjectId, parentId, text, identity, vector }) {
  const identityKey = identityKeyOf(identity, subjectType)
  const unitVector = Array.isArray(vector) ? normalized(vector) : null
  if (!identityKey || !unitVector) return null
  return {
    userId, subjectType, subjectId, parentId: parentId ?? subjectId,
    subjectVersion: contentVersion(text), identityKey, dimensions: unitVector.length, vector: unitVector,
  }
}

/** 存一行（同一对象、同一身份已有就覆盖）。 */
export function saveEmbedding(database, row) {
  const { subjectType, subjectId, identityKey } = row
  return database.embedding.upsert({
    where: { subjectType_subjectId_identityKey: { subjectType, subjectId, identityKey } },
    create: row,
    update: { subjectVersion: row.subjectVersion, dimensions: row.dimensions, vector: row.vector, parentId: row.parentId },
  })
}

/** 一次存一批（整本书的段落）；已有的跳过。 */
export function saveEmbeddings(database, rows) {
  return rows.length ? database.embedding.createMany({ data: rows, skipDuplicates: true }) : Promise.resolve({ count: 0 })
}

/** 删掉某些对象（subjectIds）或某些上级（parentIds：记忆本身、或书）名下的全部向量。 */
export function deleteEmbeddings(database, { subjectType, subjectIds, parentIds }) {
  const where = { subjectType, ...(subjectIds ? { subjectId: { in: subjectIds } } : {}), ...(parentIds ? { parentId: { in: parentIds } } : {}) }
  if ((subjectIds && !subjectIds.length) || (parentIds && !parentIds.length) || (!subjectIds && !parentIds)) return Promise.resolve({ count: 0 })
  return database.embedding.deleteMany({ where })
}

/**
 * 读她某一类对象在这个模型下的向量：Map<subjectId, { identityKey, version, vector }>。
 * identity 为空（没配向量模型）就是空表。
 */
export async function loadVectors(userId, subjectType, identity, { subjectIds, database = prisma } = {}) {
  const identityKey = identityKeyOf(identity, subjectType)
  if (!identityKey) return new Map()
  const rows = await database.embedding.findMany({
    where: { userId, subjectType, identityKey, ...(subjectIds ? { subjectId: { in: subjectIds } } : {}) },
    select: { subjectId: true, subjectVersion: true, vector: true },
  })
  return new Map(rows.map((row) => [row.subjectId, { identityKey, version: row.subjectVersion, vector: row.vector }]))
}

/** 这个向量能不能代表现在这段文字、在这个模型下拿来比。 */
export const vectorFits = (stored, identityKey, text) => Boolean(stored && identityKey
  && stored.identityKey === identityKey && stored.version === contentVersion(text))
