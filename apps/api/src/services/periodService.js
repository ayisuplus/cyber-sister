/**
 * 经期记录与预测（独立的小功能）。
 * 日期契约同日记：'yyyy-MM-dd' 按 UTC 零点存储，前端按本地日历日解析。
 * 原 toolService 的日程/倒数日/提醒已由「安排」（reminderService）替代，旧表只随导出保留。
 */
import prisma from '../prisma/client.js'
import { findOwned, deleteOwned, HttpError } from '../utils/dbHelpers.js'
import { localTodayUtc, parseUtcDay, toUtcDayString } from '../utils/dayHelpers.js'
import logger from '../utils/logger.js'

const MIN_CYCLE_DAYS = 20
const MAX_CYCLE_DAYS = 45

// 经期属于敏感个人信息：新增、修改和交给模型读取前都要用户单独同意；查看与删除自己的记录不受限。
export async function getPeriodConsent(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { periodConsentAt: true } })
  if (!user) throw new HttpError('用户不存在', 404)
  return { accepted: Boolean(user.periodConsentAt), updatedAt: user.periodConsentAt }
}

export async function setPeriodConsent(userId, accepted) {
  if (typeof accepted !== 'boolean') throw new HttpError('accepted必须是布尔值', 400)
  const updatedAt = accepted ? new Date() : null
  // 撤回记录同意时，「顾及周期」一并关掉：她不再读取经期，也就无从顾及
  await prisma.user.update({ where: { id: userId }, data: accepted ? { periodConsentAt: updatedAt } : { periodConsentAt: null, periodToneAt: null } })
  logger.info('经期记录同意状态更新', { userId, accepted })
  return { accepted, updatedAt }
}

/**
 * 「聊天时让她顾及你的周期」：记录同意之外的第二个单独同意。
 * 打开后，经期里的那几天每轮聊天会告诉模型「在经期」，只用来调语气；没有记录同意就不能打开。
 */
export async function getPeriodTone(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { periodConsentAt: true, periodToneAt: true } })
  if (!user) throw new HttpError('用户不存在', 404)
  const enabled = Boolean(user.periodConsentAt && user.periodToneAt)
  return { enabled, updatedAt: enabled ? user.periodToneAt : null }
}

export async function setPeriodTone(userId, enabled) {
  if (typeof enabled !== 'boolean') throw new HttpError('enabled必须是布尔值', 400)
  if (enabled && !(await getPeriodConsent(userId)).accepted) {
    throw Object.assign(new HttpError('先在「经期」页同意记录，才能让她顾及你的周期', 403), { code: 'PERIOD_CONSENT_REQUIRED' })
  }
  const updatedAt = enabled ? new Date() : null
  await prisma.user.update({ where: { id: userId }, data: { periodToneAt: updatedAt } })
  logger.info('顾及周期同意状态更新', { userId, enabled })
  return { enabled, updatedAt }
}

export async function assertPeriodConsent(userId) {
  const { accepted } = await getPeriodConsent(userId)
  if (!accepted) {
    throw Object.assign(new HttpError('记录经期前，需要你先在「经期」页同意保存这类数据', 403), { code: 'PERIOD_CONSENT_REQUIRED' })
  }
}

function validateCycleDays(cycleDays) {
  if (cycleDays === undefined) return undefined
  if (!Number.isInteger(cycleDays) || cycleDays < MIN_CYCLE_DAYS || cycleDays > MAX_CYCLE_DAYS) {
    throw new HttpError(`周期天数必须是${MIN_CYCLE_DAYS}到${MAX_CYCLE_DAYS}之间的整数`, 400)
  }
  return cycleDays
}

export function listPeriodRecords(userId) {
  return prisma.periodRecord.findMany({
    where: { userId },
    orderBy: { startDate: 'desc' },
  })
}

export async function createPeriodRecord(userId, { startDate, endDate, cycleDays }) {
  await assertPeriodConsent(userId)
  const start = parseUtcDay(startDate)
  const end = endDate ? parseUtcDay(endDate) : null
  if (end && end < start) throw new HttpError('结束日期不能早于开始日期', 400)
  const record = await prisma.periodRecord.create({
    data: {
      userId,
      startDate: start,
      endDate: end,
      cycleDays: validateCycleDays(cycleDays) ?? 28,
    },
  })
  logger.info('创建经期记录', { recordId: record.id, userId })
  return record
}

export async function updatePeriodRecord(userId, recordId, payload) {
  await assertPeriodConsent(userId)
  const record = await findOwned('periodRecord', recordId, userId, '经期记录')
  const start = payload.startDate === undefined ? record.startDate : parseUtcDay(payload.startDate)
  const end = payload.endDate === undefined ? record.endDate : (payload.endDate ? parseUtcDay(payload.endDate) : null)
  if (end && end < start) throw new HttpError('结束日期不能早于开始日期', 400)
  const cycleDays = validateCycleDays(payload.cycleDays) ?? record.cycleDays
  return prisma.periodRecord.update({ where: { id: record.id }, data: { startDate: start, endDate: end, cycleDays } })
}

export async function deletePeriodRecord(userId, recordId) {
  await deleteOwned('periodRecord', recordId, userId, '经期记录')
}

// 记录按 UTC 零点表示日历日，不能先转成本地日期（西半球会退到前一天）。
// 过了预计的日子还没新记录：daysUntil 仍是 0（旧调用方不变），overdueDays 如实写晚了几天。
export function predictNextPeriod(latest, asOf = localTodayUtc()) {
  const next = latest ? new Date(latest.startDate) : null
  if (next) next.setUTCDate(next.getUTCDate() + latest.cycleDays)
  const days = next ? Math.round((next.getTime() - asOf.getTime()) / 86400000) : null
  return {
    nextDate: next ? toUtcDayString(next) : null,
    daysUntil: next ? Math.max(0, days) : null,
    overdueDays: next ? Math.max(0, -days) : null,
  }
}

// 客户端仅提供其日历日用于时区展示；页面与工具复用同一预测口径。
export async function getPeriodSummary(userId, today) {
  const asOf = today === undefined ? localTodayUtc() : parseUtcDay(today)
  const latest = await prisma.periodRecord.findFirst({ where: { userId }, orderBy: { startDate: 'desc' } })
  return {
    asOf: toUtcDayString(asOf),
    ...predictNextPeriod(latest, asOf),
    basedOnRecordId: latest?.id ?? null,
    source: 'server_calculation',
  }
}
