/**
 * 用户显式记忆服务。
 * 记忆只能由用户创建和维护，不进行自动提取或虚构初始化。
 */
import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'
import { embedMemory } from './embeddingService.js'
import { assertRevision, withMemoryTransaction, ownedMemory, validateSources, recordRevision, invalidateMemoryDependencies } from './memoryGovernance.js'

export const MEMORY_TYPES = ['semantic', 'episodic', 'procedural']
const MAX_CONTENT_LENGTH = 2000
const MAX_TAGS = 10
const MAX_TAG_LENGTH = 30

function parseJson(value, fallback) {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

export function formatMemory(memory) {
  // embedding/embeddingModel 是机器投影：永不进入 API 响应（检索侧由 llmService 剥离）
  const { embedding: _embedding, embeddingModel: _embeddingModel, projection: _projection, ...rest } = memory
  return {
    ...rest,
    entities: parseJson(memory.entities, {}),
    tags: parseJson(memory.tags, []),
  }
}

function validateType(type) {
  if (!MEMORY_TYPES.includes(type)) {
    throw new HttpError(`记忆类型必须是以下值之一: ${MEMORY_TYPES.join(', ')}`, 400)
  }
  return type
}

function validateContent(content) {
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new HttpError('记忆内容不能为空', 400)
  }
  const normalized = content.trim()
  if (normalized.length > MAX_CONTENT_LENGTH) {
    throw new HttpError(`记忆内容不能超过${MAX_CONTENT_LENGTH}个字符`, 400)
  }
  return normalized
}

function validateImportance(importance) {
  if (!Number.isInteger(importance) || importance < 1 || importance > 10) {
    throw new HttpError('重要程度必须是1到10之间的整数', 400)
  }
  return importance
}

function validateTags(tags) {
  if (!Array.isArray(tags) || tags.length > MAX_TAGS) {
    throw new HttpError(`标签必须是最多${MAX_TAGS}项的数组`, 400)
  }

  const normalized = tags.map((tag) => {
    if (typeof tag !== 'string' || tag.trim().length === 0 || tag.trim().length > MAX_TAG_LENGTH) {
      throw new HttpError(`每个标签必须为1到${MAX_TAG_LENGTH}个字符`, 400)
    }
    return tag.trim()
  })

  return [...new Set(normalized)]
}

export const MEMORY_ORIGINS = ['manual', 'suggestion', 'promoted']

export function validateMemoryInput({ type, content, importance = 5, tags = [] } = {}) {
  return { type: validateType(type), content: validateContent(content), importance: validateImportance(importance), tags: validateTags(tags) }
}

function validateOrigin(origin) {
  if (!MEMORY_ORIGINS.includes(origin)) throw new HttpError('记忆来源不合法', 400)
  return origin
}

function validateSourceRef(sourceRef) {
  if (sourceRef === null || sourceRef === undefined) return null
  if (typeof sourceRef !== 'string') throw new HttpError('来源引用不合法', 400)
  const trimmed = sourceRef.trim()
  if (trimmed.length < 1 || trimmed.length > 64) throw new HttpError('来源引用不合法', 400)
  return trimmed
}

export async function createMemory(userId, {
  type,
  content,
  importance = 5,
  tags = [],
  origin = 'manual',
  sourceRef = null,
  sources = [],
  expiresAt = null,
}, { projectEmbedding = true, tx = null, portableId, memoryId, action = 'create', trustedSources = false, deduplicate = false } = {}) {
  // 即使命中去重，输入仍须经过相同校验，不能用已有内容绕过类型和来源约束。
  type = validateType(type)
  content = validateContent(content)
  importance = validateImportance(importance)
  tags = validateTags(tags)
  origin = validateOrigin(origin)
  sourceRef = validateSourceRef(sourceRef)
  const write = async (database) => {
    await database.user.update({ where: { id: userId }, data: { memoryEpoch: { increment: 1 } } })
    let references = sources
    if (origin === 'suggestion') {
      validateSourceRef(sourceRef)
      const source = await database.message.findFirst({ where: { id: sourceRef, role: 'user', conversation: { userId } } })
      if (!source) throw new HttpError('来源消息不存在', 404)
      references = [{ type: 'message', id: source.id, quote: source.content.slice(0, 2000) }]
    }
    references = trustedSources ? references : await validateSources(database, userId, references)
    const normalize = (value) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
    if (deduplicate) {
      const candidates = await database.memory.findMany({ where: { userId } })
      const existing = candidates.find((candidate) => candidate.type === type && normalize(candidate.content) === normalize(content)
        && (!candidate.expiresAt || new Date(candidate.expiresAt) > new Date()))
      if (existing) {
        const updated = await database.memory.update({ where: { id: existing.id }, data: {
          revision: { increment: 1 }, sources: [...existing.sources, ...references].slice(-20),
        } })
        await database.memoryProjection.updateMany({ where: { memoryId: existing.id, memoryRevision: existing.revision }, data: { memoryRevision: updated.revision } })
        await database.memoryEdge.updateMany({ where: { userId, fromMemoryId: existing.id, fromRevision: existing.revision }, data: { fromRevision: updated.revision } })
        await database.memoryEdge.updateMany({ where: { userId, toMemoryId: existing.id, toRevision: existing.revision }, data: { toRevision: updated.revision } })
        await recordRevision(database, updated, action)
        return updated
      }
    }
    const memory = await database.memory.create({
    data: {
      userId,
      ...(memoryId ? { id: memoryId } : {}),
      type: validateType(type),
      content: validateContent(content),
      importance: validateImportance(importance),
      tags: JSON.stringify(validateTags(tags)),
      origin: validateOrigin(origin),
      sourceRef: validateSourceRef(sourceRef),
      sources: references,
      ...(portableId ? { portableId } : {}),
      // 有效期只由服务端设（如做梦的「近期小结」），过期后检索与聊天都不再用它
      ...(expiresAt instanceof Date && !Number.isNaN(expiresAt.getTime()) ? { expiresAt } : {}),
    },
    })
    await recordRevision(database, memory, action)
    return memory
  }
  const memory = tx ? await write(tx) : await withMemoryTransaction(userId, write)

  logger.info('创建记忆', { memoryId: memory.id, userId, origin: memory.origin })
  // 语义投影可重建：fire-and-forget，失败仅本轮无向量，不影响保存结果
  if (projectEmbedding && !tx) void embedMemory(memory)
  return formatMemory(memory)
}

export async function listMemories(userId, { type, page = 1, limit = 20 } = {}) {
  const normalizedPage = Number.isInteger(page) && page > 0 ? page : 1
  const normalizedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20
  const where = { userId }

  if (type !== undefined && type !== '') {
    where.type = validateType(type)
  }
  const [memories, total] = await Promise.all([
    prisma.memory.findMany({
      where,
      // 放在心上的排在最前
      orderBy: [{ pinned: 'desc' }, { importance: 'desc' }, { createdAt: 'desc' }],
      skip: (normalizedPage - 1) * normalizedLimit,
      take: normalizedLimit,
    }),
    prisma.memory.count({ where }),
  ])

  return {
    data: memories.map(formatMemory),
    total,
    page: normalizedPage,
    limit: normalizedLimit,
  }
}

export async function updateMemory(userId, memoryId, updates) {
  return changeMemory(userId, memoryId, updates)
}

export const MAX_PINNED_MEMORIES = 5

/**
 * 「放在心上」：每轮都带给她，不靠聊到才想起。
 * 这不是改内容：不升版本、不写修订记录（「她是怎么记住的」只记内容的变化）。
 * 上限在持有用户行锁的事务里判断，两次并发的放上去不会一起挤过第 5 条。
 */
export async function setMemoryPinned(userId, memoryId, pinned) {
  if (typeof pinned !== 'boolean') throw new HttpError('pinned 必须是布尔值', 400)
  const memory = await withMemoryTransaction(userId, async (tx) => {
    const current = await ownedMemory(tx, userId, memoryId)
    if (current.pinned === pinned) return current
    if (pinned) {
      const count = await tx.memory.count({ where: { userId, pinned: true } })
      if (count >= MAX_PINNED_MEMORIES) throw new HttpError(`最多放 ${MAX_PINNED_MEMORIES} 件在心上，先拿下一件再放`, 400)
    }
    return tx.memory.update({ where: { id: current.id }, data: { pinned } })
  })
  return formatMemory(memory)
}

async function changeMemory(userId, memoryId, updates) {
  const memory = await withMemoryTransaction(userId, async (tx) => {
    const current = await ownedMemory(tx, userId, memoryId)
    assertRevision(current, updates.expectedRevision)
    await tx.user.update({ where: { id: userId }, data: { memoryEpoch: { increment: 1 } } })
  const updateData = {}
  if (updates.type !== undefined) updateData.type = validateType(updates.type)
  if (updates.content !== undefined) {
    updateData.content = validateContent(updates.content)
    // 内容与投影一起失效，重建失败时走关键词检索，不能继续使用旧内容的向量。
    updateData.embedding = []
    updateData.embeddingModel = null
  }
  if (updates.importance !== undefined) updateData.importance = validateImportance(updates.importance)
  if (updates.tags !== undefined) updateData.tags = JSON.stringify(validateTags(updates.tags))

  if (Object.keys(updateData).length === 0) {
    throw new HttpError('没有可更新的记忆字段', 400)
  }

    const changedMeaning = (updateData.content !== undefined && updateData.content !== current.content)
      || (updateData.type !== undefined && updateData.type !== current.type)
    const updated = await tx.memory.update({ where: { id: memoryId }, data: { ...updateData, revision: { increment: 1 } } })
    if (changedMeaning) await invalidateMemoryDependencies(tx, userId, memoryId)
    else {
      await tx.memoryProjection.updateMany({ where: { memoryId, memoryRevision: current.revision }, data: { memoryRevision: updated.revision } })
      await tx.memoryEdge.updateMany({ where: { userId, fromMemoryId: memoryId, fromRevision: current.revision }, data: { fromRevision: updated.revision } })
      await tx.memoryEdge.updateMany({ where: { userId, toMemoryId: memoryId, toRevision: current.revision }, data: { toRevision: updated.revision } })
    }
    await recordRevision(tx, updated, 'edit')
    return updated
  })
  if (updates.content !== undefined || updates.type !== undefined) {
    // 内容变更后投影失效：fire-and-forget 重建向量，失败仅本轮无向量
    void embedMemory(memory)
  }
  logger.info('编辑记忆', { memoryId, userId })
  return formatMemory(memory)
}

export async function getMemory(userId, memoryId) {
  const memory = await ownedMemory(prisma, userId, memoryId)
  return formatMemory(memory)
}

async function eraseMemories(tx, userId, ids) {
  await tx.user.update({ where: { id: userId }, data: { memoryEpoch: { increment: 1 } } })
  await tx.memoryIndexJob.updateMany({ where: { userId, status: { in: ['queued', 'running'] } }, data: { status: 'cancelled' } })
  await tx.derivedInsight.deleteMany({ where: { userId, OR: [{ promotedMemoryId: { in: ids } }, { sourceMemoryIds: { hasSome: ids } }] } })
  // 删除来源时只擦除依赖副本中的引用，其他用户已确认的正文仍由其自身生命周期管理。
  const scrub = (sources) => (Array.isArray(sources) ? sources : []).filter((source) => !(source.type === 'memory' && ids.includes(source.id)))
  const remaining = await tx.memory.findMany({ where: { userId, id: { notIn: ids } }, select: { id: true, sources: true } })
  for (const memory of remaining) {
    if (scrub(memory.sources).length !== memory.sources.length) {
      // eslint-disable-next-line no-await-in-loop
      await tx.memory.update({ where: { id: memory.id }, data: { sources: scrub(memory.sources), sourceRef: null } })
    }
  }
  const revisions = await tx.memoryRevision.findMany({ where: { memory: { userId, id: { notIn: ids } } }, select: { id: true, sources: true } })
  for (const revision of revisions) {
    if (scrub(revision.sources).length !== revision.sources.length) {
      // 隐私删除是历史不可变规则的唯一例外：擦除引用副本，不更改历史正文。
      // eslint-disable-next-line no-await-in-loop
      await tx.memoryRevision.update({ where: { id: revision.id }, data: { sources: scrub(revision.sources) } })
    }
  }
  return tx.memory.deleteMany({ where: { userId, id: { in: ids } } })
}

export async function deleteMemory(userId, memoryId) {
  await withMemoryTransaction(userId, async (tx) => {
    await ownedMemory(tx, userId, memoryId)
    await eraseMemories(tx, userId, [memoryId])
  })
  logger.info('删除记忆', { memoryId, userId })
}
