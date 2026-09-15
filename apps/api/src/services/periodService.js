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

// 客户端仅提供其日历日用于时区展示；预测口径与记录读取集中在后端。
export async function getPeriodSummary(userId, today) {
  const asOf = today === undefined ? localTodayUtc() : parseUtcDay(today)
  const latest = await prisma.periodRecord.findFirst({ where: { userId }, orderBy: { startDate: 'desc' } })
  const next = latest ? new Date(latest.startDate) : null
  if (next) next.setUTCDate(next.getUTCDate() + latest.cycleDays)
  return {
    asOf: toUtcDayString(asOf),
    nextDate: next ? toUtcDayString(next) : null,
    daysUntil: next ? Math.max(0, Math.round((next.getTime() - asOf.getTime()) / 86400000)) : null,
    basedOnRecordId: latest?.id ?? null,
    source: 'server_calculation',
  }
}
