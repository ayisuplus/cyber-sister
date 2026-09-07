/**
 * 专注自习服务：番茄钟结束后的自习记录、今日/本周/连续天数统计，
 * 每条记录可生成幂等的姐妹人格化短评（脱敏、同意门与日记一致）。
 * 记录不可编辑只可删，短评不会因内容变化失效。
 */
import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import { generateCompanionNote } from './llmService.js'
import { buildUserModelOptions } from './userModelOptions.js'
import { streakOf } from './habitService.js'
import logger from '../utils/logger.js'

const MAX_MINUTES = 240
const SUBJECT_MAX = 20
const NOTE_MAX = 200
const DAY_MS = 24 * 60 * 60 * 1000

function validateMinutes(minutes) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
    throw new HttpError(`专注时长必须为1到${MAX_MINUTES}分钟`, 400)
  }
  return minutes
}

function serializeSession(s) {
  return {
    id: s.id,
    subject: s.subject,
    plannedMinutes: s.plannedMinutes,
    actualMinutes: s.actualMinutes,
    note: s.note,
    aiComment: s.aiComment,
    aiCommentSource: s.aiCommentSource,
    startedAt: s.startedAt,
    createdAt: s.createdAt,
  }
}

/** 本地日历日 'yyyy-MM-dd'（与 streakOf 内部基准同一口径）。 */
function localDayString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function recordSession(userId, { plannedMinutes, actualMinutes, subject, note, startedAt }) {
  const actual = validateMinutes(actualMinutes)
  const planned = plannedMinutes === undefined ? actual : validateMinutes(plannedMinutes)
  let safeSubject
  if (subject !== undefined && subject !== null) {
    const trimmed = String(subject).trim()
    if (trimmed.length > SUBJECT_MAX) throw new HttpError(`科目不能超过${SUBJECT_MAX}个字符`, 400)
    safeSubject = trimmed || null
  }
  let safeNote
  if (note !== undefined && note !== null) {
    const trimmed = String(note).trim()
    if (trimmed.length > NOTE_MAX) throw new HttpError(`收获不能超过${NOTE_MAX}个字符`, 400)
    safeNote = trimmed || null
  }
  let safeStartedAt = new Date()
  if (startedAt !== undefined && startedAt !== null) {
    safeStartedAt = new Date(startedAt)
    if (Number.isNaN(safeStartedAt.getTime())) throw new HttpError('开始时间格式不正确', 400)
  }
  const session = await prisma.studySession.create({
    data: {
      userId,
      subject: safeSubject ?? null,
      plannedMinutes: planned,
      actualMinutes: actual,
      note: safeNote ?? null,
      startedAt: safeStartedAt,
    },
  })
  logger.info('记录自习', { userId })
  return serializeSession(session)
}

export async function listSessions(userId, days = 30) {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new HttpError('天数必须为1到365的整数', 400)
  const since = new Date(Date.now() - days * DAY_MS)
  const sessions = await prisma.studySession.findMany({
    where: { userId, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return sessions.map(serializeSession)
}

export async function getSummary(userId) {
  const sessions = await prisma.studySession.findMany({
    where: { userId, createdAt: { gte: new Date(Date.now() - 365 * DAY_MS) } },
    select: { createdAt: true, actualMinutes: true },
  })
  const todayStr = localDayString(new Date())
  const weekDays = new Set()
  for (let i = 0; i < 7; i += 1) weekDays.add(localDayString(new Date(Date.now() - i * DAY_MS)))
  let todayMinutes = 0
  let weekMinutes = 0
  const dayStrings = []
  for (const s of sessions) {
    const day = localDayString(s.createdAt)
    dayStrings.push(day)
    if (day === todayStr) todayMinutes += s.actualMinutes
    if (weekDays.has(day)) weekMinutes += s.actualMinutes
  }
  return { todayMinutes, weekMinutes, streak: streakOf(dayStrings), totalSessions: sessions.length }
}

/**
 * 为一次自习记录生成（或复用）AI 闺蜜回应。
 * 幂等：已有回应直接返回，不重复消耗模型；记录不可编辑，无需失效逻辑。
 */
export async function generateSessionComment(userId, sessionId, requestId) {
  const session = await prisma.studySession.findFirst({ where: { id: sessionId, userId } })
  if (!session) throw new HttpError('这条记录不存在', 404)
  if (session.aiComment) {
    return { aiComment: session.aiComment, source: session.aiCommentSource, reused: true }
  }

  const { user, modelOptions } = await buildUserModelOptions(userId)
  const note = await generateCompanionNote({
    persona: user.persona,
    instruction: `用户刚完成一次专注自习：科目「${session.subject || '未标记'}」，计划 ${session.plannedMinutes} 分钟，实际专注 ${session.actualMinutes} 分钟。${session.note ? '她记了一句收获，回应时可以呼应它。' : ''}作为她的 AI 闺蜜，用 1-2 句话回应：认可她的投入，顺便提醒她休息一下眼睛、喝口水；不说教、不打鸡血、不和任何人比较。`,
    userText: session.note || '我刚专注完，陪我一下？',
  }, requestId, modelOptions)

  const updated = await prisma.studySession.update({
    where: { id: session.id },
    data: { aiComment: note.content, aiCommentSource: note.source },
  })
  logger.info('生成自习回应', { userId, source: note.source })
  return { aiComment: updated.aiComment, source: updated.aiCommentSource, reused: false }
}
