/**
 * 用户显式记忆服务。
 * 记忆只能由用户创建和维护，不进行自动提取或虚构初始化。
 */
import prisma from '../prisma/client.js'
import { findOwned, deleteOwned, HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'

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

function formatMemory(memory) {
  return {
    ...memory,
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

export async function createMemory(userId, {
  type,
  content,
  importance = 5,
  tags = [],
}) {
  const memory = await prisma.memory.create({
    data: {
      userId,
      type: validateType(type),
      content: validateContent(content),
      importance: validateImportance(importance),
      tags: JSON.stringify(validateTags(tags)),
    },
  })

  logger.info('创建记忆', { memoryId: memory.id, userId })
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
      orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
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
  await findOwned('memory', memoryId, userId, '记忆')

  const updateData = {}
  if (updates.type !== undefined) updateData.type = validateType(updates.type)
  if (updates.content !== undefined) updateData.content = validateContent(updates.content)
  if (updates.importance !== undefined) updateData.importance = validateImportance(updates.importance)
  if (updates.tags !== undefined) updateData.tags = JSON.stringify(validateTags(updates.tags))

  if (Object.keys(updateData).length === 0) {
    throw new HttpError('没有可更新的记忆字段', 400)
  }

  const memory = await prisma.memory.update({ where: { id: memoryId }, data: updateData })
  logger.info('编辑记忆', { memoryId, userId })
  return formatMemory(memory)
}

export async function deleteMemory(userId, memoryId) {
  await deleteOwned('memory', memoryId, userId, '记忆')
  logger.info('删除记忆', { memoryId, userId })
}

export async function clearAllMemories(userId) {
  const result = await prisma.memory.deleteMany({ where: { userId } })
  logger.info('清空所有记忆', { userId, count: result.count })
  return result.count
}
