/**
 * 记忆服务
 * 封装用户记忆的业务逻辑
 */
import prisma from '../prisma/client.js'
import { findOwned, deleteOwned } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'

// 初始 Mock 记忆数据（新用户注册后自动填充）
const INIT_MEMORIES = [
  { type: 'semantic', content: '用户叫小雨，在上海工作，做产品经理', entities: { name: '小雨', city: '上海', job: '产品经理' }, importance: 9, tags: ['基本信息'] },
  { type: 'semantic', content: '不吃香菜，对芒果过敏', entities: {}, importance: 8, tags: ['饮食', '健康'] },
  { type: 'episodic', content: '上周和老板吵架了，因为项目方向问题', entities: {}, importance: 6, tags: ['工作', '情绪'] },
  { type: 'semantic', content: '男朋友叫小明，异地恋，在北京', entities: { name: '小明', relation: '男友' }, importance: 8, tags: ['感情'] },
  { type: 'episodic', content: '最近在减肥，目标是瘦到100斤', entities: {}, importance: 5, tags: ['健康'] },
  { type: 'procedural', content: '喜欢听毒舌风格的回复，不要太温柔', entities: {}, importance: 7, tags: ['偏好'] },
]

/**
 * 初始化用户记忆（仅新用户，已有记忆则跳过）
 */
export async function initUserMemories(userId) {
  const existingCount = await prisma.memory.count({ where: { userId } })
  if (existingCount === 0) {
    await prisma.memory.createMany({
      data: INIT_MEMORIES.map(m => ({
        userId,
        type: m.type,
        content: m.content,
        entities: JSON.stringify(m.entities),
        importance: m.importance,
        tags: JSON.stringify(m.tags),
      })),
    })
    logger.info('初始化用户记忆', { userId, count: INIT_MEMORIES.length })
  }
}

/**
 * 格式化记忆（解析 JSON 字段）
 */
function formatMemory(m) {
  return {
    ...m,
    entities: m.entities ? JSON.parse(m.entities) : {},
    tags: m.tags ? JSON.parse(m.tags) : [],
  }
}

/**
 * 获取记忆列表（支持类型筛选、搜索、分页）
 */
export async function listMemories(userId, { type, search, page = 1, limit = 20 } = {}) {
  await initUserMemories(userId)

  const where = { userId }
  if (type) where.type = type
  if (search) where.content = { contains: search }

  const [memories, total] = await Promise.all([
    prisma.memory.findMany({
      where,
      orderBy: { importance: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.memory.count({ where }),
  ])

  return {
    data: memories.map(formatMemory),
    total,
    page,
    limit,
  }
}

/**
 * 编辑记忆
 */
export async function updateMemory(userId, memoryId, { content, importance, tags }) {
  await findOwned('memory', memoryId, userId, '记忆')
  const updateData = {}
  if (content !== undefined) updateData.content = content
  if (importance !== undefined) updateData.importance = importance
  if (tags !== undefined) updateData.tags = JSON.stringify(tags)
  const memory = await prisma.memory.update({ where: { id: memoryId }, data: updateData })
  logger.info('编辑记忆', { memoryId, userId })
  return formatMemory(memory)
}

/**
 * 删除单条记忆
 */
export async function deleteMemory(userId, memoryId) {
  await deleteOwned('memory', memoryId, userId, '记忆')
  logger.info('删除记忆', { memoryId, userId })
}

/**
 * 清空用户所有记忆
 */
export async function clearAllMemories(userId) {
  await prisma.memory.deleteMany({ where: { userId } })
  logger.info('清空所有记忆', { userId })
}
