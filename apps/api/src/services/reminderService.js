/**
 * 自定义定时提醒服务
 * 「nextFireAt 落库 + 惰性投递」：创建/编辑时预计算下次触发时刻；
 * 到点由前端轮询 /api/reminders/due 触发幂等投递（同 letters 的读取时生成模式）。
 * 无后台 worker、无推送通道。
 */
import prisma from '../prisma/client.js'
import { findOwned, deleteOwned, HttpError } from '../utils/dbHelpers.js'

const MAX_CONTENT_LENGTH = 200
const MAX_INSTRUCTION_LENGTH = 500
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const FREQS = ['once', 'daily', 'weekly', 'monthly']

// ============ 校验 ============

function validateContent(content) {
  if (typeof content !== 'string' || !content.trim() || content.trim().length > MAX_CONTENT_LENGTH) {
    throw new HttpError(`提醒内容必须为1到${MAX_CONTENT_LENGTH}个字符`, 400)
  }
  return content.trim()
}

function validateTime(time) {
  if (typeof time !== 'string' || !TIME_PATTERN.test(time)) {
    throw new HttpError('提醒时间必须是 HH:mm 格式', 400)
  }
  return time
}

function validateDate(date) {
  if (typeof date !== 'string' || !DATE_PATTERN.test(date) || Number.isNaN(new Date(date).getTime())) {
    throw new HttpError('日期必须是 yyyy-MM-dd 格式', 400)
  }
  return date
}

function validateWeekdays(weekdays) {
  if (!Array.isArray(weekdays) || weekdays.length === 0
    || weekdays.some(d => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new HttpError('每周提醒需要至少一个 0-6 的星期数（0 为周日）', 400)
  }
  return [...new Set(weekdays)].sort()
}

function validateMonthDay(monthDay) {
  if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) {
    throw new HttpError('每月提醒的日期必须是 1-31 的整数', 400)
  }
  return monthDay
}

// 任务指令：可选；非空字符串且 ≤500 字。null/空串一律归一化为 null（= 纯提醒）
function validateInstruction(instruction) {
  if (instruction === undefined || instruction === null || instruction === '') return null
  if (typeof instruction !== 'string' || !instruction.trim() || instruction.trim().length > MAX_INSTRUCTION_LENGTH) {
    throw new HttpError(`任务指令必须为1到${MAX_INSTRUCTION_LENGTH}个字符`, 400)
  }
  return instruction.trim()
}

// ============ 下次触发时刻（纯函数，本地时间语义） ============

function localAt(date, time) {
  const [h, m] = time.split(':').map(Number)
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m, 0, 0)
  return d
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

/**
 * 计算 after 之后的下一次触发时刻。
 * once 返回 fireAt 本身（已过时刻表示立即到期）。
 */
export function computeNextFire({ freq, time, fireAt, weekdays = [], monthDay = null }, after = new Date()) {
  if (freq === 'once') {
    return fireAt instanceof Date ? fireAt : new Date(fireAt)
  }
  if (freq === 'daily') {
    let candidate = localAt(after, time)
    if (candidate <= after) candidate = localAt(new Date(after.getFullYear(), after.getMonth(), after.getDate() + 1), time)
    return candidate
  }
  if (freq === 'weekly') {
    for (let offset = 0; offset <= 7; offset++) {
      const day = new Date(after.getFullYear(), after.getMonth(), after.getDate() + offset)
      if (!weekdays.includes(day.getDay())) continue
      const candidate = localAt(day, time)
      if (candidate > after) return candidate
    }
  }
  if (freq === 'monthly') {
    for (let offset = 0; offset <= 13; offset++) {
      const base = new Date(after.getFullYear(), after.getMonth() + offset, 1)
      const day = Math.min(monthDay, daysInMonth(base.getFullYear(), base.getMonth()))
      const candidate = localAt(new Date(base.getFullYear(), base.getMonth(), day), time)
      if (candidate > after) return candidate
    }
  }
  throw new HttpError(`不支持的提醒频率：${freq}`, 400)
}

// ============ CRUD ============

function buildFields(args) {
  const freq = args.freq ?? 'once'
  if (!FREQS.includes(freq)) throw new HttpError(`提醒频率必须是 ${FREQS.join('/')}`, 400)

  const fields = { content: validateContent(args.content), freq, weekdays: [], monthDay: null, fireAt: null, time: null, instruction: validateInstruction(args.instruction) }

  if (freq === 'once') {
    const time = validateTime(args.time)
    const date = validateDate(args.date)
    const [y, mo, d] = date.split('-').map(Number)
    const [h, mi] = time.split(':').map(Number)
    fields.fireAt = new Date(y, mo - 1, d, h, mi, 0, 0)
    fields.time = time
  } else {
    fields.time = validateTime(args.time)
    if (freq === 'weekly') fields.weekdays = validateWeekdays(args.weekdays)
    if (freq === 'monthly') fields.monthDay = validateMonthDay(args.monthDay)
  }
  fields.nextFireAt = computeNextFire(fields)
  return fields
}

export function createScheduledReminder(userId, args) {
  const fields = buildFields(args)
  return prisma.scheduledReminder.create({ data: { userId, ...fields } })
}

export function listScheduledReminders(userId) {
  return prisma.scheduledReminder.findMany({
    where: { userId },
    orderBy: { nextFireAt: 'asc' },
  })
}

export async function updateScheduledReminder(id, userId, args) {
  await findOwned('scheduledReminder', id, userId, '提醒')
  const updateData = {}
  if (args.content !== undefined) updateData.content = validateContent(args.content)
  if (args.instruction !== undefined) updateData.instruction = validateInstruction(args.instruction)
  if (args.status !== undefined) {
    if (!['active', 'paused'].includes(args.status)) throw new HttpError('状态只能是 active 或 paused', 400)
    updateData.status = args.status
  }
  // 时间相关字段任一变化则整体重建并重算 nextFireAt
  if (args.freq !== undefined || args.time !== undefined || args.date !== undefined
    || args.weekdays !== undefined || args.monthDay !== undefined) {
    const current = await findOwned('scheduledReminder', id, userId, '提醒')
    const fields = buildFields({
      content: current.content,
      freq: args.freq ?? current.freq,
      time: args.time ?? current.time,
      date: args.date,
      weekdays: args.weekdays ?? current.weekdays,
      monthDay: args.monthDay ?? current.monthDay,
    })
    delete fields.content
    delete fields.instruction
    Object.assign(updateData, fields)
    if (current.status === 'done') updateData.status = 'active'
  }
  return prisma.scheduledReminder.update({ where: { id }, data: updateData })
}

export function deleteScheduledReminder(id, userId) {
  return deleteOwned('scheduledReminder', id, userId, '提醒')
}

// ============ 到点投递（幂等） ============

/**
 * 拉到点未投递的提醒：对每条 active 且 nextFireAt <= now 的提醒幂等 upsert 投递实例，
 * 返回 pending 投递（含提醒内容）。不推进 nextFireAt——由 ack 驱动。
 */
export async function listDueReminders(userId, now = new Date()) {
  const due = await prisma.scheduledReminder.findMany({
    where: { userId, status: 'active', nextFireAt: { lte: now } },
  })
  // 并发或重复轮询撞唯一键：投递已存在，静默复用（letters 同款幂等模式）
  await Promise.all(due.map((reminder) =>
    prisma.reminderDelivery.create({
      data: { reminderId: reminder.id, fireAt: reminder.nextFireAt },
    }).catch((err) => {
      if (err?.code !== 'P2002') throw err
    })
  ))
  return prisma.reminderDelivery.findMany({
    where: { status: 'pending', reminder: { userId } },
    include: { reminder: { select: { id: true, content: true, freq: true, time: true, instruction: true } } },
    orderBy: { fireAt: 'asc' },
  })
}

// 调度推进：一次性置 done，循环类算下一次（执行或确认后共用）
async function advanceSchedule(reminder, fireAt) {
  if (reminder.freq === 'once') {
    await prisma.scheduledReminder.update({ where: { id: reminder.id }, data: { status: 'done' } })
  } else {
    await prisma.scheduledReminder.update({
      where: { id: reminder.id },
      data: { nextFireAt: computeNextFire(reminder, fireAt) },
    })
  }
}

async function findOwnedDelivery(deliveryId, userId) {
  const delivery = await prisma.reminderDelivery.findUnique({
    where: { id: deliveryId },
    include: { reminder: true },
  })
  if (!delivery || delivery.reminder.userId !== userId) throw new HttpError('提醒投递不存在', 404)
  return delivery
}

/**
 * 定时任务执行成功：产出写入投递（保持 pending 等用户在铃铛里看到），调度立即推进。
 * 推进不依赖用户确认，避免未读时反复执行同一批任务。
 */
export async function completeTaskDelivery(deliveryId, userId, result) {
  const delivery = await findOwnedDelivery(deliveryId, userId)
  const updated = await prisma.reminderDelivery.update({
    where: { id: deliveryId },
    data: { result: String(result ?? '').slice(0, 4000) },
  })
  await advanceSchedule(delivery.reminder, delivery.fireAt)
  return updated
}

/** 定时任务执行失败：标记 failed 并推进调度，不做无限重试。 */
export async function failTaskDelivery(deliveryId, userId) {
  const delivery = await findOwnedDelivery(deliveryId, userId)
  const updated = await prisma.reminderDelivery.update({
    where: { id: deliveryId },
    data: { status: 'failed' },
  })
  await advanceSchedule(delivery.reminder, delivery.fireAt)
  return updated
}

/**
 * 确认投递：标记 shown/dismissed；一次性提醒置 done，循环提醒推进 nextFireAt。
 */
export async function ackDelivery(deliveryId, userId, action) {
  if (!['shown', 'dismissed'].includes(action)) throw new HttpError('操作只能是 shown 或 dismissed', 400)
  const delivery = await findOwnedDelivery(deliveryId, userId)

  const updated = await prisma.reminderDelivery.update({
    where: { id: deliveryId },
    data: { status: action },
  })

  // 纯提醒在确认时才推进（任务已在执行时推进，这里重复推进无副作用：
  // 一次性已 done，循环类 nextFireAt 已越过本次 fireAt，computeNextFire 幂等）
  if (delivery.reminder.status !== 'done' && delivery.reminder.nextFireAt <= delivery.fireAt) {
    await advanceSchedule(delivery.reminder, delivery.fireAt)
  }
  return updated
}
