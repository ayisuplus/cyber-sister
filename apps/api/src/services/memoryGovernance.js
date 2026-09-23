import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'

export function conflict(message = '内容已经变化，请刷新后核对再保存') {
  const error = new HttpError(message, 409)
  error.code = 'MEMORY_CONFLICT'
  return error
}

export function assertRevision(record, expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new HttpError('需要提供当前版本号', 400)
  if (record.revision !== expectedRevision) throw conflict()
}

// 同一用户的正式写入、来源校验和投影提交串行化；网络调用必须在事务外。
export function withMemoryTransaction(userId, operation) {
  return prisma.$transaction(async (tx) => {
    const owner = await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`
    if (owner.length === 0) throw new HttpError('用户不存在', 404)
    return operation(tx)
  }, { timeout: 20000 })
}

export async function ownedMemory(tx, userId, id) {
  const memory = await tx.memory.findFirst({ where: { id, userId } })
  if (!memory) throw new HttpError('记忆不存在', 404)
  return memory
}

// 六类来源的查找与正文口径：message/memory 是原有两类，手记/读书/日历/收藏是生活痕迹（trace）
const SOURCE_SPECS = {
  message:      { find: (tx, userId, id) => tx.message.findFirst({ where: { id, role: 'user', conversation: { userId } } }), text: (r) => r.content },
  memory:       { find: (tx, userId, id) => tx.memory.findFirst({ where: { id, userId } }), text: (r) => r.content, revisioned: true },
  diary:        { find: (tx, userId, id) => tx.diaryEntry.findFirst({ where: { id, userId } }), text: (r) => r.content ?? '' },
  reading_note: { find: (tx, userId, id) => tx.readingNote.findFirst({ where: { id, userId } }), text: (r) => [r.quote, r.content].filter(Boolean).join('\n') },
  task:         { find: (tx, userId, id) => tx.scheduledReminder.findFirst({ where: { id, userId } }), text: (r) => r.content ?? '' },
  collection:   { find: (tx, userId, id) => tx.collectionItem.findFirst({ where: { id, userId } }), text: (r) => [r.name, r.note].filter(Boolean).join('\n') },
}

export async function validateSources(tx, userId, sources) {
  if (!Array.isArray(sources) || sources.length > 20) throw new HttpError('来源格式不正确', 400)
  const result = []
  for (const source of sources) {
    const spec = source ? SOURCE_SPECS[source.type] : null
    if (!spec || typeof source.id !== 'string'
      || typeof source.quote !== 'string' || !source.quote.trim() || source.quote.length > 2000) {
      throw new HttpError('来源必须包含对象和有效引用片段', 400)
    }
    // eslint-disable-next-line no-await-in-loop
    const record = await spec.find(tx, userId, source.id)
    if (!record) throw conflict('来源已不可用，请重新核对内容')
    if (spec.revisioned && (source.revision !== record.revision
      || (record.expiresAt && new Date(record.expiresAt) <= new Date()))) throw conflict('来源记忆已变化，请重新核对')
    if (!spec.text(record).includes(source.quote)) throw conflict('引用片段与来源不一致')
    result.push({ type: source.type, id: record.id, quote: source.quote,
      ...(spec.revisioned ? { revision: record.revision } : {}), status: 'verified' })
  }
  return result
}

export function recordRevision(tx, memory, action, restoredFrom = null) {
  return tx.memoryRevision.create({ data: {
    memoryId: memory.id, revision: memory.revision, type: memory.type, content: memory.content,
    importance: memory.importance, tags: memory.tags, expiresAt: memory.expiresAt,
    origin: memory.origin, sources: memory.sources, action, restoredFrom,
  } })
}

export async function invalidateMemoryDependencies(tx, userId, memoryId) {
  await tx.memoryProjection.deleteMany({ where: { memoryId } })
  await tx.memoryEdge.updateMany({
    where: { userId, status: { in: ['canonical', 'derived'] }, OR: [{ fromMemoryId: memoryId }, { toMemoryId: memoryId }] },
    data: { status: 'needs_review', revision: { increment: 1 } },
  })
  await tx.derivedInsight.updateMany({
    where: { userId, status: 'active', sourceMemoryIds: { has: memoryId } },
    data: { status: 'needs_review', revision: { increment: 1 } },
  })
}
