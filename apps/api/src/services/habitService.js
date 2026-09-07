/**
 * 手帐（习惯打卡）服务：习惯 CRUD、按本地日历日打卡、连续天数统计、
 * 聚合数据驱动的 AI 鼓励（只送习惯名与计数，不送日记等正文内容）。
 */
import prisma from '../prisma/client.js'
import { findOwned, HttpError } from '../utils/dbHelpers.js'
import { generateCompanionNote } from './llmService.js'
import { buildUserModelOptions } from './userModelOptions.js'
import { localTodayUtc, parseUtcDay, toUtcDayString } from '../utils/dayHelpers.js'
import logger from '../utils/logger.js'

export const HABIT_ICONS = new Set(['droplet', 'moon', 'dumbbell', 'book', 'flower', 'pen'])
const MAX_ACTIVE_HABITS = 12
const HABIT_NAME_MAX = 20
const RECENT_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

function validateHabitName(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > HABIT_NAME_MAX) {
    throw new HttpError(`习惯名称必须为1到${HABIT_NAME_MAX}个字符`, 400)
  }
  return name.trim()
}

function validateHabitIcon(icon) {
  if (!HABIT_ICONS.has(icon)) throw new HttpError('图标不在可选范围内', 400)
  return icon
}

/** 连续打卡天数：今天已打则从今天往回数，否则从昨天往回数。 */
export function streakOf(dayStrings) {
  const days = new Set(dayStrings)
  let cursor = localTodayUtc()
  if (!days.has(toUtcDayString(cursor))) cursor = new Date(cursor.getTime() - DAY_MS)
  let streak = 0
  while (days.has(toUtcDayString(cursor))) {
    streak += 1
    cursor = new Date(cursor.getTime() - DAY_MS)
  }
  return streak
}

export async function listHabitsWithStatus(userId) {
  const since = new Date(localTodayUtc().getTime() - (RECENT_DAYS - 1) * DAY_MS)
  const habits = await prisma.habit.findMany({
    where: { userId, archivedAt: null },
    orderBy: { createdAt: 'asc' },
    include: { checkins: { where: { day: { gte: since } }, select: { day: true } } },
  })
  const today = toUtcDayString(localTodayUtc())
  return habits.map((habit) => {
    const dayStrings = habit.checkins.map((c) => toUtcDayString(c.day))
    return {
      id: habit.id,
      name: habit.name,
      icon: habit.icon,
      checkedToday: dayStrings.includes(today),
      streak: streakOf(dayStrings),
      recentDays: dayStrings.sort(),
    }
  })
}

export async function createHabit(userId, { name, icon }) {
  const activeCount = await prisma.habit.count({ where: { userId, archivedAt: null } })
  if (activeCount >= MAX_ACTIVE_HABITS) throw new HttpError(`最多同时追踪 ${MAX_ACTIVE_HABITS} 个习惯`, 400)
  const habit = await prisma.habit.create({
    data: { userId, name: validateHabitName(name), icon: validateHabitIcon(icon) },
  })
  logger.info('创建习惯', { userId, habitId: habit.id })
  return { id: habit.id, name: habit.name, icon: habit.icon }
}

export async function updateHabit(userId, habitId, { name, icon }) {
  await findOwned('habit', habitId, userId, '习惯')
  const data = {}
  if (name !== undefined) data.name = validateHabitName(name)
  if (icon !== undefined) data.icon = validateHabitIcon(icon)
  const habit = await prisma.habit.update({ where: { id: habitId }, data })
  return { id: habit.id, name: habit.name, icon: habit.icon }
}

export async function archiveHabit(userId, habitId) {
  await findOwned('habit', habitId, userId, '习惯')
  await prisma.habit.update({ where: { id: habitId }, data: { archivedAt: new Date() } })
  logger.info('归档习惯', { userId, habitId })
}

/** 切换某天打卡状态；返回 { checked, day }。 */
export async function toggleCheckin(userId, habitId, dayStr) {
  await findOwned('habit', habitId, userId, '习惯')
  const day = dayStr ? parseUtcDay(dayStr) : localTodayUtc()
  const existing = await prisma.habitCheckin.findUnique({
    where: { habitId_day: { habitId, day } },
  })
  if (existing) {
    await prisma.habitCheckin.delete({ where: { id: existing.id } })
    return { checked: false, day: toUtcDayString(day) }
  }
  await prisma.habitCheckin.create({ data: { habitId, userId, day } })
  return { checked: true, day: toUtcDayString(day) }
}

/** 幂等置位打卡（智能体工具用：重复调用不产生副作用翻转）。 */
export async function setCheckin(userId, habitId, dayStr, checked) {
  await findOwned('habit', habitId, userId, '习惯')
  const day = dayStr ? parseUtcDay(dayStr) : localTodayUtc()
  const existing = await prisma.habitCheckin.findUnique({
    where: { habitId_day: { habitId, day } },
  })
  if (checked && !existing) {
    await prisma.habitCheckin.create({ data: { habitId, userId, day } })
  } else if (!checked && existing) {
    await prisma.habitCheckin.delete({ where: { id: existing.id } })
  }
  return { checked, day: toUtcDayString(day) }
}

/** 按习惯名精确查找（智能体工具用）；找不到时给出当前可选名称。 */
export async function findHabitByName(userId, name) {
  const normalized = typeof name === 'string' ? name.trim() : ''
  if (!normalized) return null
  const habits = await prisma.habit.findMany({
    where: { userId, archivedAt: null },
    select: { id: true, name: true, icon: true },
  })
  const exact = habits.find((h) => h.name === normalized)
  if (exact) return exact
  const error = new HttpError(
    habits.length === 0
      ? '还没有创建任何习惯'
      : `没有找到叫「${normalized}」的习惯，当前有：${habits.map((h) => h.name).join('、')}`,
    400,
  )
  throw error
}

/**
 * 聚合打卡状态生成 1-2 句人格化鼓励。
 * 只把习惯名/连续天数/今日完成计数送入模型，不送任何正文内容。
 */
export async function generateCheer(userId, requestId) {
  const status = await listHabitsWithStatus(userId)
  if (status.length === 0) return { cheer: null, source: null }

  const { user, modelOptions } = await buildUserModelOptions(userId)
  const doneToday = status.filter((h) => h.checkedToday).length
  const summary = status
    .map((h) => `${h.name}：连续 ${h.streak} 天${h.checkedToday ? '（今天已打卡）' : '（今天还没打）'}`)
    .join('；')
  const note = await generateCompanionNote({
    persona: user.persona,
    instruction: [
      `用户今天的手帐打卡情况：${summary}。共 ${status.length} 个习惯，今天已完成 ${doneToday} 个。`,
      '作为她的 AI 闺蜜，用 1-2 句话回应：做得好就具体夸，没开始就轻轻催一下；',
      '不说教、不排名、不和别人比较。',
    ].join(''),
    userText: '看看我今天的手帐打卡怎么样？',
  }, requestId, modelOptions)
  logger.info('生成手帐鼓励', { userId, source: note.source })
  return { cheer: note.content, source: note.source }
}
