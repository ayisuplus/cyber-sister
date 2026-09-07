/**
 * 日记服务：按本地日历日一记（userId+day 唯一），心情与聊天同词表，
 * AI 回应经人格化短评生成（内容统一脱敏、同意门与聊天一致）。
 */
import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import { generateCompanionNote } from './llmService.js'
import { buildUserModelOptions } from './userModelOptions.js'
import { parseUtcDay, toUtcDayString } from '../utils/dayHelpers.js'
import logger from '../utils/logger.js'

const MOODS = new Set(['happy', 'neutral', 'sad', 'angry', 'anxious'])
export const MOOD_LABELS = { happy: '开心', neutral: '平静', sad: '难过', angry: '生气', anxious: '焦虑' }
const MAX_CONTENT_LENGTH = 2000
const MONTH_PATTERN = /^\d{4}-\d{2}$/

function validateContent(content) {
  if (typeof content !== 'string' || !content.trim() || content.trim().length > MAX_CONTENT_LENGTH) {
    throw new HttpError(`日记内容必须为1到${MAX_CONTENT_LENGTH}个字符`, 400)
  }
  return content.trim()
}

function validateMood(mood) {
  if (!MOODS.has(mood)) throw new HttpError('心情必须是开心、平静、难过、生气或焦虑之一', 400)
  return mood
}

function serialize(entry) {
  return {
    id: entry.id,
    day: toUtcDayString(entry.day),
    mood: entry.mood,
    content: entry.content,
    aiComment: entry.aiComment,
    aiCommentSource: entry.aiCommentSource,
    updatedAt: entry.updatedAt,
  }
}

export async function upsertEntry(userId, dayStr, { content, mood }) {
  const day = parseUtcDay(dayStr)
  const text = validateContent(content)
  const safeMood = validateMood(mood)
  // 内容变化后旧的 AI 回应不再可信，一并清除（可重新生成）
  const entry = await prisma.diaryEntry.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, content: text, mood: safeMood },
    update: { content: text, mood: safeMood, aiComment: null, aiCommentSource: null },
  })
  logger.info('保存日记', { userId, day: dayStr })
  return serialize(entry)
}

export async function listMonth(userId, monthStr) {
  if (typeof monthStr !== 'string' || !MONTH_PATTERN.test(monthStr)) {
    throw new HttpError('月份必须是 yyyy-MM 格式', 400)
  }
  const start = parseUtcDay(`${monthStr}-01`)
  const end = new Date(start)
  end.setUTCMonth(end.getUTCMonth() + 1)
  const entries = await prisma.diaryEntry.findMany({
    where: { userId, day: { gte: start, lt: end } },
    orderBy: { day: 'desc' },
  })
  return entries.map(serialize)
}

export async function getEntry(userId, dayStr) {
  const day = parseUtcDay(dayStr)
  const entry = await prisma.diaryEntry.findUnique({ where: { userId_day: { userId, day } } })
  if (!entry) throw new HttpError('这一天还没有日记', 404)
  return serialize(entry)
}

export async function deleteEntry(userId, dayStr) {
  const day = parseUtcDay(dayStr)
  const entry = await prisma.diaryEntry.findUnique({ where: { userId_day: { userId, day } } })
  if (!entry) throw new HttpError('这一天还没有日记', 404)
  await prisma.diaryEntry.delete({ where: { id: entry.id } })
  logger.info('删除日记', { userId, day: dayStr })
}

/**
 * 为某天日记生成（或复用）AI 闺蜜回应。
 * 幂等：已有回应直接返回，不重复消耗模型；内容被编辑后回应清空，可再生成。
 */
export async function generateComment(userId, dayStr, requestId) {
  const day = parseUtcDay(dayStr)
  const entry = await prisma.diaryEntry.findUnique({ where: { userId_day: { userId, day } } })
  if (!entry) throw new HttpError('这一天还没有日记，先写点什么吧', 404)
  if (entry.aiComment) {
    return { aiComment: entry.aiComment, source: entry.aiCommentSource, reused: true }
  }

  const { user, modelOptions } = await buildUserModelOptions(userId)
  const note = await generateCompanionNote({
    persona: user.persona,
    instruction: [
      `用户写了 ${dayStr} 的日记，心情是「${MOOD_LABELS[entry.mood]}」。`,
      '作为她的 AI 闺蜜，用 2-3 句话回应：先接住她的情绪，再给一点轻轻的陪伴或鼓励；',
      '不说教、不评价、不替她做决定。',
    ].join(''),
    userText: entry.content,
  }, requestId, modelOptions)

  const updated = await prisma.diaryEntry.update({
    where: { id: entry.id },
    data: { aiComment: note.content, aiCommentSource: note.source },
  })
  logger.info('生成日记回应', { userId, day: dayStr, source: note.source })
  return { aiComment: updated.aiComment, source: updated.aiCommentSource, reused: false }
}
