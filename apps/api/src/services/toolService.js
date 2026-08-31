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

function validateTodoContent(content) {
  if (typeof content !== 'string' || !content.trim() || content.trim().length > MAX_TODO_CONTENT_LENGTH) {
    throw new HttpError(`待办内容必须为1到${MAX_TODO_CONTENT_LENGTH}个字符`, 400)
  }
  return content.trim()
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

export async function createTodo(userId, { content, dueDate }) {
  const todo = await prisma.todo.create({
    data: { userId, content: validateTodoContent(content), dueDate: dueDate ? new Date(dueDate) : null },
  })
  logger.info('创建待办', { todoId: todo.id, userId })
  return todo
}

export async function updateTodo(userId, todoId, { content, dueDate, isDone }) {
  await findOwned('todo', todoId, userId, '待办')
  const updateData = {}
  if (content !== undefined) updateData.content = validateTodoContent(content)
  if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null
  if (isDone !== undefined) updateData.isDone = isDone
  const todo = await prisma.todo.update({ where: { id: todoId }, data: updateData })
  logger.info('更新待办', { todoId, userId })
  return todo
}

export async function deleteTodo(userId, todoId) {
  await deleteOwned('todo', todoId, userId, '待办')
  logger.info('删除待办', { todoId, userId })
}

// ============ 倒数日 ============

export function listCountdowns(userId) {
  return prisma.countdown.findMany({
    where: { userId },
    orderBy: { targetDate: 'asc' },
  })
}

export async function createCountdown(userId, { title, targetDate }) {
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
  const created = []
  for (const preset of DEFAULT_REMINDERS) {
    created.push(await prisma.reminder.upsert({
      where: { userId_type: { userId, type: preset.type } },
      create: { userId, ...preset, isActive: false },
      update: {},
    }))
  }
  return created
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
