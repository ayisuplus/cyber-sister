/**
 * 对话服务
 * 封装会话和消息的业务逻辑，路由层只做参数验证和响应
 */
import prisma from '../prisma/client.js'
import { findOwned, HttpError } from '../utils/dbHelpers.js'
import { generateResponse, detectCrisis } from './llmService.js'
import logger from '../utils/logger.js'
import { cacheGet, cacheSet, cacheDel } from '../utils/redis.js'

const CONVERSATIONS_CACHE_TTL = 120  // 会话列表缓存 2 分钟
const convCacheKey = (userId) => `chat:conversations:${userId}`

/**
 * 失效用户的会话列表缓存
 */
async function invalidateConvCache(userId) {
  await cacheDel(convCacheKey(userId))
}

/**
 * 获取用户的会话列表（含最新一条消息预览，缓存 2 分钟）
 */
export async function listConversations(userId) {
  const cached = await cacheGet(convCacheKey(userId))
  if (cached) return cached

  const conversations = await prisma.conversation.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: {
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })

  await cacheSet(convCacheKey(userId), conversations, CONVERSATIONS_CACHE_TTL)
  return conversations
}

/**
 * 创建新会话
 */
export async function createConversation(userId, { title = '赛博姐妹', persona = 'toxic' } = {}) {
  const conversation = await prisma.conversation.create({
    data: { userId, title, persona },
  })
  logger.info('新建会话', { conversationId: conversation.id, userId })
  await invalidateConvCache(userId)
  return conversation
}

/**
 * 获取会话详情（含所有消息）
 */
export async function getConversation(conversationId, userId) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!conversation) {
    throw new HttpError('会话不存在', 404)
  }
  return conversation
}

/**
 * 删除会话（级联删除消息）
 */
export async function deleteConversation(conversationId, userId) {
  await findOwned('conversation', conversationId, userId, '会话')
  await prisma.conversation.delete({ where: { id: conversationId } })
  logger.info('删除会话', { conversationId, userId })
  await invalidateConvCache(userId)
}

/**
 * 发送消息并生成 AI 回复
 * @returns {{ userMessage, aiMessage, crisisLevel }}
 */
export async function sendMessage(conversationId, userId, content) {
  // 验证会话归属
  const conversation = await findOwned('conversation', conversationId, userId, '会话')

  // 保存用户消息
  const userMsg = await prisma.message.create({
    data: {
      conversationId,
      role: 'user',
      content: content.trim(),
    },
  })

  // 危机检测
  const crisisLevel = detectCrisis(content)
  if (crisisLevel) {
    logger.warn('检测到危机内容', { userId, conversationId, crisisLevel })
    return { userMessage: userMsg, aiMessage: null, crisisLevel }
  }

  // 获取历史消息构建上下文
  const historyMessages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  })

  // 获取用户记忆（高重要性 + 未过期），注入对话上下文
  const userMemories = await prisma.memory.findMany({
    where: {
      userId,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    orderBy: { importance: 'desc' },
    take: 20,  // 取前 20 条高重要性记忆用于检索
    select: { content: true, type: true, importance: true },
  })

  // 生成 AI 回复（传入记忆以个性化）
  const aiResponse = await generateResponse(content, conversation.persona, historyMessages, userMemories)

  const aiMsg = await prisma.message.create({
    data: {
      conversationId,
      role: 'assistant',
      content: aiResponse.content,
      emotion: aiResponse.emotion,
    },
  })

  // 更新会话时间
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  })

  logger.debug('消息发送成功', { conversationId, userId })
  await invalidateConvCache(userId)
  return { userMessage: userMsg, aiMessage: aiMsg, crisisLevel: null }
}
