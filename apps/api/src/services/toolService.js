/**
 * 工具服务
 * 封装待办、倒数日、经期、提醒的业务逻辑
 */
import prisma from '../prisma/client.js'
import { findOwned, deleteOwned, HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'

const MAX_TODO_CONTENT_LENGTH = 500
const MIN_CYCLE_DAYS = 20
const MAX_CYCLE_DAYS = 45
const REMINDER_TIME_PATTERN = /^\d{2}:\d{2}$/
const TODO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TODO_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

function validateTodoContent(content) {
  if (typeof content !== 'string' || !content.trim() || content.trim().length > MAX_TODO_CONTENT_LENGTH) {
    throw new HttpError(`待办内容必须为1到${MAX_TODO_CONTENT_LENGTH}个字符`, 400)
  }
  return content.trim()
}

// 日程日期契约同日记：'yyyy-MM-dd' 按 UTC 零点存储，前端按本地日历日解析
function validateTodoDueDate(dueDate) {
  if (dueDate === undefined) return undefined
  if (dueDate === null || dueDate === '') return null
  if (typeof dueDate !== 'string' || !TODO_DATE_PATTERN.test(dueDate) || Number.isNaN(new Date(dueDate).getTime())) {
    throw new HttpError('日程日期必须是 yyyy-MM-dd 格式', 400)
  }
  return new Date(dueDate)
}

function validateTodoDueTime(dueTime) {
  if (dueTime === undefined) return undefined
  if (dueTime === null || dueTime === '') return null
  if (typeof dueTime !== 'string' || !TODO_TIME_PATTERN.test(dueTime)) {
    throw new HttpError('日程时间必须是 HH:mm 格式', 400)
  }
  return dueTime
}

function validateCycleDays(cycleDays) {
  if (cycleDays === undefined) return undefined
  if (!Number.isInteger(cycleDays) || cycleDays < MIN_CYCLE_DAYS || cycleDays > MAX_CYCLE_DAYS) {
    throw new HttpError(`周期天数必须是${MIN_CYCLE_DAYS}到${MAX_CYCLE_DAYS}之间的整数`, 400)
  }
  return cycleDays
}

function validateReminderTime(time) {
  if (time === undefined) return undefined
  if (typeof time !== 'string' || !REMINDER_TIME_PATTERN.test(time)) {
    throw new HttpError('提醒时间必须是 HH:mm 格式', 400)
  }
  return time
}

// ============ 待办 ============

export function listTodos(userId) {
  return prisma.todo.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createTodo(userId, { content, dueDate, dueTime }) {
  const date = validateTodoDueDate(dueDate) ?? null
  const time = validateTodoDueTime(dueTime) ?? null
  if (time && !date) throw new HttpError('设置时间前请先选择日期', 400)
  const todo = await prisma.todo.create({
    data: { userId, content: validateTodoContent(content), dueDate: date, dueTime: time },
  })
  logger.info('创建日程', { todoId: todo.id, userId })
  return todo
}

export async function updateTodo(userId, todoId, { content, dueDate, isDone, dueTime }) {
  const existing = await findOwned('todo', todoId, userId, '日程')
  const updateData = {}
  if (content !== undefined) updateData.content = validateTodoContent(content)
  if (dueDate !== undefined) updateData.dueDate = validateTodoDueDate(dueDate)
  if (dueTime !== undefined) updateData.dueTime = validateTodoDueTime(dueTime)
  if (isDone !== undefined) updateData.isDone = isDone
  const effectiveDate = dueDate !== undefined ? updateData.dueDate : existing.dueDate
  if (updateData.dueTime && !effectiveDate) throw new HttpError('设置时间前请先选择日期', 400)
  const todo = await prisma.todo.update({ where: { id: todoId }, data: updateData })
  logger.info('更新日程', { todoId, userId })
  return todo
}

export async function deleteTodo(userId, todoId) {
  await deleteOwned('todo', todoId, userId, '日程')
  logger.info('删除日程', { todoId, userId })
}

// ============ 倒数日 ============

export function listCountdowns(userId) {
  return prisma.countdown.findMany({
    where: { userId },
    orderBy: { targetDate: 'asc' },
  })
}

export async function createCountdown(userId, { title, targetDate }) {
  // 日期契约：'yyyy-MM-dd' 按 UTC 零点存储，前端按本地日历日解析比较
  const countdown = await prisma.countdown.create({
    data: { userId, title, targetDate: new Date(targetDate) },
  })
  logger.info('创建倒数日', { countdownId: countdown.id, userId })
  return countdown
}

export async function deleteCountdown(userId, countdownId) {
  await deleteOwned('countdown', countdownId, userId, '倒数日')
  logger.info('删除倒数日', { countdownId, userId })
}

// ============ 大姨妈 ============

export function listPeriodRecords(userId) {
  return prisma.periodRecord.findMany({
    where: { userId },
    orderBy: { startDate: 'desc' },
  })
}

export async function createPeriodRecord(userId, { startDate, endDate, cycleDays }) {
  // 日期契约：'yyyy-MM-dd' 按 UTC 零点存储，前端按本地日历日解析比较
  const record = await prisma.periodRecord.create({
    data: {
      userId,
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : null,
      cycleDays: validateCycleDays(cycleDays) ?? 28,
    },
  })
  logger.info('创建经期记录', { recordId: record.id, userId })
  return record
}

// ============ 提醒 ============

// 首次读取时为该用户物化默认提醒：默认关闭，由用户在设置页显式开启。
// upsert 依赖 reminders 的 (user_id, type) 唯一约束，并发首读不会重复建行。
const DEFAULT_REMINDERS = [
  { type: 'water', time: '10:00' },
  { type: 'sleep', time: '23:00' },
  { type: 'period', time: '09:00' },
]

export async function listReminders(userId) {
  const existing = await prisma.reminder.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
  if (existing.length > 0) return existing
  // 三条默认提醒并行物化；Promise.all 保持与 DEFAULT_REMINDERS 相同的返回顺序
  return Promise.all(DEFAULT_REMINDERS.map((preset) => prisma.reminder.upsert({
    where: { userId_type: { userId, type: preset.type } },
    create: { userId, ...preset, isActive: false },
    update: {},
  })))
}

export async function updateReminder(userId, reminderId, { time, isActive }) {
  await findOwned('reminder', reminderId, userId, '提醒')
  const updateData = {}
  if (time !== undefined) updateData.time = validateReminderTime(time)
  if (isActive !== undefined) updateData.isActive = isActive
  const reminder = await prisma.reminder.update({ where: { id: reminderId }, data: updateData })
  logger.info('更新提醒', { reminderId, userId })
  return reminder
}
