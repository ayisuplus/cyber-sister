/**
 * 对话服务：归属校验、外部回退授权、危机阻断和消息事务。
 */
import prisma from '../prisma/client.js'
import { findOwned, HttpError } from '../utils/dbHelpers.js'
import {
  generateResponse,
  detectCrisis,
} from './llmService.js'
import { getCrisisIntervention } from './detection.js'
import { EXTERNAL_LLM_CONSENT_VERSION } from './userService.js'
import logger from '../utils/logger.js'

const MAX_HISTORY_MESSAGES = 19
// 记忆注入上限：按重要度/更新时间截断，避免全量载入撑爆上下文
const MAX_MEMORIES_FOR_PROMPT = 200
const DEFAULT_CONVERSATION_PAGE_SIZE = 20
const MAX_CONVERSATION_PAGE_SIZE = 50
const DEFAULT_MESSAGE_PAGE_SIZE = 50
const MAX_MESSAGE_PAGE_SIZE = 100

function normalizePagination(page, limit, defaultLimit, maxLimit) {
  const normalizedPage = Number.isInteger(page) && page > 0 ? page : 1
  const normalizedLimit = Number.isInteger(limit) && limit > 0
    ? Math.min(limit, maxLimit)
    : defaultLimit
  return { skip: (normalizedPage - 1) * normalizedLimit, take: normalizedLimit }
}

export function listConversations(userId, { page, limit } = {}) {
  const { skip, take } = normalizePagination(
    page, limit, DEFAULT_CONVERSATION_PAGE_SIZE, MAX_CONVERSATION_PAGE_SIZE,
  )
  return prisma.conversation.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    skip,
    take,
    include: {
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })

}

export async function createConversation(userId, { title = '赛博姐妹' } = {}) {
  const conversation = await prisma.conversation.create({
    data: { userId, title },
  })
  logger.info('新建会话', { conversationId: conversation.id, userId })
  return conversation
}

export async function getConversation(conversationId, userId, { page, limit } = {}) {
  const messagePagination = normalizePagination(
    page, limit, DEFAULT_MESSAGE_PAGE_SIZE, MAX_MESSAGE_PAGE_SIZE,
  )
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    include: {
      messages: { orderBy: { createdAt: 'asc' }, ...messagePagination },
    },
  })
  if (!conversation) throw new HttpError('会话不存在', 404)
  return conversation
}

export async function deleteConversation(conversationId, userId) {
  await findOwned('conversation', conversationId, userId, '会话')
  await prisma.conversation.delete({ where: { id: conversationId } })
  logger.info('删除会话', { conversationId, userId })
}

async function persistTurn(conversationId, userId, content, response) {
  const result = await prisma.$transaction(async (tx) => {
    const userMessage = await tx.message.create({
      data: { conversationId, role: 'user', content },
    })
    const aiMessage = await tx.message.create({
      data: {
        conversationId,
        role: 'assistant',
        content: response.content,
        emotion: response.emotion,
        source: response.source,
      },
    })
    await tx.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    })
    return { userMessage, aiMessage }
  })

  return result
}

async function persistBlockedCrisis(conversationId, userId, content, level) {
  const intervention = getCrisisIntervention(level)
  const result = await prisma.$transaction(async (tx) => {
    const userMessage = await tx.message.create({
      data: { conversationId, role: 'user', content },
    })
    await tx.message.create({
      data: {
        conversationId,
        role: 'assistant',
        content: intervention.message,
        emotion: 'concerned',
        source: 'local_template',
      },
    })
    await tx.crisisLog.create({
      data: {
        userId,
        triggerMsg: null,
        level,
        handled: true,
      },
    })
    await tx.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    })
    return { userMessage }
  })

  return {
    status: 'blocked',
    userMessage: result.userMessage,
    intervention,
  }
}

/**
 * 发送消息。
 *
 * 正常模型回复成功前不写入当前消息，因此超时/供应商失败可以安全重试；
 * 危机分支例外，它必须先于同意检查并以单个事务留下完整干预记录。
 */
export async function sendMessage(conversationId, userId, rawContent, requestId) {
  await findOwned('conversation', conversationId, userId, '会话')
  const content = rawContent.trim()

  const crisisLevel = detectCrisis(content)
  if (crisisLevel) {
    logger.warn('检测到危机内容', { userId, conversationId, crisisLevel })
    return persistBlockedCrisis(conversationId, userId, content, crisisLevel)
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      persona: true,
      externalLlmConsent: true,
      externalLlmConsentVersion: true,
    },
  })
  if (!user) throw new HttpError('用户不存在', 404)

  const allowExternal = user.externalLlmConsent === true
    && user.externalLlmConsentVersion === EXTERNAL_LLM_CONSENT_VERSION
  const modelOptions = { allowExternal }
  if (allowExternal) {
    modelOptions.authorizeExternal = async () => {
      const currentConsent = await prisma.user.findUnique({
        where: { id: userId },
        select: { externalLlmConsent: true, externalLlmConsentVersion: true },
      })
      return currentConsent?.externalLlmConsent === true
        && currentConsent.externalLlmConsentVersion === EXTERNAL_LLM_CONSENT_VERSION
    }
  }

  // 数据库按倒序只取最近 19 条，之后恢复成旧到新；当前消息由 llmService 追加一次。
  const [descendingHistory, memories] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: MAX_HISTORY_MESSAGES,
      select: { role: true, content: true },
    }),
    prisma.memory.findMany({
      where: {
        userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
      take: MAX_MEMORIES_FOR_PROMPT,
      select: { content: true, type: true, importance: true, tags: true },
    }),
  ])

  const history = [...descendingHistory].reverse()
  const aiResponse = await generateResponse(
    content,
    user.persona,
    history,
    memories,
    requestId,
    modelOptions,
  )
  const saved = await persistTurn(conversationId, userId, content, aiResponse)

  logger.debug('消息发送成功', {
    requestId,
    conversationId,
    userId,
    source: aiResponse.source,
    provider: aiResponse.provider,
    model: aiResponse.model,
  })
  return { status: 'ok', ...saved, source: aiResponse.source }
}
