/**
 * 自习计时联调、确认记录与统计。计时状态是有界的进程内模拟；
 * 用户确认的记录写入数据库，新的云端短评只返回模拟预览。
 */
import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import { randomUUID } from 'node:crypto'
import { generateWorkComment } from './workCloudService.js'
import { streakOf } from './habitService.js'
import logger from '../utils/logger.js'

const MAX_MINUTES = 240
const SUBJECT_MAX = 20
const NOTE_MAX = 200
const DAY_MS = 24 * 60 * 60 * 1000
// 联调中的计时接口仅保存在当前进程；确认后的自习记录仍写入原数据库。
const activeRuns = new Map()
const MAX_ACTIVE_USERS = 1000

function pruneRuns() {
  for (const [userId, run] of activeRuns) {
    if (run.expiresAt <= Date.now() && !run.saving) activeRuns.delete(userId)
  }
}

function serializeRun(run) {
  if (!run) return null
  return {
    id: run.id, status: run.status, subject: run.subject, plannedMinutes: run.plannedMinutes,
    startedAt: new Date(run.startedAt).toISOString(), finishedAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : null,
    actualMinutes: run.actualMinutes ?? null, savedSession: run.savedSession ?? null,
    serverNow: new Date().toISOString(),
    execution: { mode: 'mock', storage: 'memory', persisted: false, expiresAt: new Date(run.expiresAt).toISOString() },
  }
}

function ownedRun(userId, runId) {
  pruneRuns()
  const run = activeRuns.get(userId)
  if (!run || run.id !== runId) throw new HttpError('这次计时不存在或已过期，请重新开始', 404)
  return run
}

export function getActiveSession(userId) {
  pruneRuns()
  return serializeRun(activeRuns.get(userId))
}

export function startSession(userId, { plannedMinutes, subject } = {}) {
  validateMinutes(plannedMinutes)
  const safeSubject = subject == null ? null : String(subject).trim() || null
  if (safeSubject?.length > SUBJECT_MAX) throw new HttpError(`科目不能超过${SUBJECT_MAX}个字符`, 400)
  pruneRuns()
  const current = activeRuns.get(userId)
  if (current && current.status !== 'saved') throw new HttpError('还有一轮自习未处理，请继续或放弃它', 409)
  if (!current && activeRuns.size >= MAX_ACTIVE_USERS) throw new HttpError('模拟计时已满，请稍后再试', 503)
  const run = { id: randomUUID(), status: 'running', subject: safeSubject, plannedMinutes, startedAt: Date.now(), expiresAt: Date.now() + DAY_MS }
  activeRuns.set(userId, run)
  return serializeRun(run)
}

export function finishSession(userId, runId) {
  const run = ownedRun(userId, runId)
  if (run.status === 'running') {
    run.finishedAt = Date.now()
    run.actualMinutes = Math.min(run.plannedMinutes, Math.max(1, Math.ceil((run.finishedAt - run.startedAt) / 60000)))
    run.status = 'finished'
  }
  return serializeRun(run)
}

export function cancelSession(userId, runId) {
  const run = ownedRun(userId, runId)
  if (run.saving) throw new HttpError('这次记录正在保存，请稍后重试', 409)
  activeRuns.delete(userId)
  return { cancelled: true }
}

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

export async function recordSession(userId, { plannedMinutes, actualMinutes, subject, note, startedAt, runId } = {}) {
  if (runId !== undefined) {
    const run = ownedRun(userId, runId)
    if (run.status === 'running') throw new HttpError('请先结束这次计时再保存', 409)
    if (run.savedSession) return run.savedSession
    if (run.saving) return run.saving
    run.saving = recordSession(userId, {
      plannedMinutes: run.plannedMinutes, actualMinutes: run.actualMinutes,
      subject: run.subject, startedAt: run.startedAt, note,
    })
    try {
      run.savedSession = await run.saving
      run.status = 'saved'
      return run.savedSession
    } finally {
      run.saving = null
    }
  }
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
 * 复用既有回应；未生成过的记录只预览模拟云端回应，不写入数据库。
 */
export async function generateSessionComment(userId, sessionId, requestId) {
  const session = await prisma.studySession.findFirst({ where: { id: sessionId, userId } })
  if (!session) throw new HttpError('这条记录不存在', 404)
  if (session.aiComment) {
    return { aiComment: session.aiComment, source: session.aiCommentSource, reused: true }
  }

  const result = await generateWorkComment('study', {
    subject: session.subject, plannedMinutes: session.plannedMinutes,
    actualMinutes: session.actualMinutes, note: session.note, requestId,
  })
  return { aiComment: result.content, source: result.source, reused: false, execution: result.execution }
}
