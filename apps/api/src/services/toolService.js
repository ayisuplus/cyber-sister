/**
 * 工具服务
 * 封装待办、倒数日、经期、提醒的业务逻辑
 */
import prisma from '../prisma/client.js'
import { findOwned, deleteOwned, HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'

// ============ 待办 ============

export async function listTodos(userId) {
  return prisma.todo.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createTodo(userId, { content, dueDate }) {
  const todo = await prisma.todo.create({
    data: { userId, content, dueDate: dueDate ? new Date(dueDate) : null },
  })
  logger.info('创建待办', { todoId: todo.id, userId })
  return todo
}

export async function updateTodo(userId, todoId, { content, dueDate, isDone }) {
  await findOwned('todo', todoId, userId, '待办')
  const updateData = {}
  if (content !== undefined) updateData.content = content
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

export async function listCountdowns(userId) {
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

export async function listPeriodRecords(userId) {
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
      cycleDays: cycleDays || 28,
    },
  })
  logger.info('创建经期记录', { recordId: record.id, userId })
  return record
}

// ============ 提醒 ============

export async function listReminders(userId) {
  return prisma.reminder.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
}

export async function updateReminder(userId, reminderId, { time, isActive }) {
  await findOwned('reminder', reminderId, userId, '提醒')
  const updateData = {}
  if (time !== undefined) updateData.time = time
  if (isActive !== undefined) updateData.isActive = isActive
  const reminder = await prisma.reminder.update({ where: { id: reminderId }, data: updateData })
  logger.info('更新提醒', { reminderId, userId })
  return reminder
}
