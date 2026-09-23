/**
 * 一次性迁移：把日程、倒数日、习惯和旧提醒转成「安排」（定时任务），按用户幂等。
 *
 * 规则（2026-09 功能收拢已批准）：
 * - 未完成且时间在未来的日程 → 一次性安排（有时间用原时间，否则 09:00）。
 *   已过期或没有日期的 → 已暂停的一次性安排（日期取原日期或迁移当天），不制造一批"到期"投递。
 * - 未来的倒数日 → 一次性安排 09:00；已经过去的不迁移。
 * - 未归档的习惯 → 每日安排 21:00，内容「打卡：{名称}」。
 * - 已开启的喝水/睡觉提醒 → 按原时间的每日安排；经期提醒由经期关怀卡承接，不迁移。
 * - 已完成的日程、打卡记录与自习记录不迁移；它们和旧表一起保留，只随数据导出带出。
 * - 安排内容上限 200 字，更长的日程截断保存，原文仍在旧表与导出里。
 * 已迁移的用户（users.plans_migrated_at 非空）直接跳过；日志只记计数，不记内容。
 */
import prisma from '../prisma/client.js'
import { buildTaskFields } from './reminderService.js'
import { toLocalDayString as localDateString, toUtcDayString } from '../utils/dayHelpers.js'
import logger from '../utils/logger.js'

const MAX_CONTENT = 200
const DEFAULT_TODO_TIME = '09:00'
const DEFAULT_COUNTDOWN_TIME = '09:00'
const DEFAULT_HABIT_TIME = '21:00'
const LEGACY_REMINDER_LABELS = { water: '喝水', sleep: '该睡觉了' }

const clip = (text) => {
  const value = String(text ?? '').trim()
  return value.length > MAX_CONTENT ? `${value.slice(0, MAX_CONTENT - 1)}…` : value
}

// 旧表的日期是"本地日历日按 UTC 零点存储"：还原成 yyyy-MM-dd 后再拼本地时间
const localFireAt = (dayString, time) => {
  const [y, m, d] = dayString.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  return new Date(y, m - 1, d, h, mi, 0, 0)
}

/**
 * 纯函数：由旧数据快照得出要创建的安排（不含 userId）。
 * 单条旧数据不合规（如历史遗留的非法时间）只跳过并计数，不拖垮该用户的整批迁移。
 * @returns {{ tasks: object[], skipped: number }} tasks 与 scheduledReminder.create 的 data 同形
 */
export function planTasks({ todos = [], countdowns = [], habits = [], reminders = [] }, now = new Date()) {
  const tasks = []
  let skipped = 0
  const add = (args, status) => {
    try {
      tasks.push({ ...buildTaskFields(args), status })
    } catch {
      skipped += 1
    }
  }

  for (const todo of todos) {
    if (todo.isDone) continue
    const time = todo.dueTime || DEFAULT_TODO_TIME
    const date = todo.dueDate ? toUtcDayString(todo.dueDate) : localDateString(now)
    const upcoming = Boolean(todo.dueDate) && localFireAt(date, time) > now
    add({ content: clip(todo.content), freq: 'once', date, time }, upcoming ? 'active' : 'paused')
  }

  for (const countdown of countdowns) {
    const date = toUtcDayString(countdown.targetDate)
    if (localFireAt(date, DEFAULT_COUNTDOWN_TIME) <= now) continue
    add({ content: clip(countdown.title), freq: 'once', date, time: DEFAULT_COUNTDOWN_TIME }, 'active')
  }

  for (const habit of habits) {
    if (habit.archivedAt) continue
    add({ content: clip(`打卡：${habit.name}`), freq: 'daily', time: DEFAULT_HABIT_TIME }, 'active')
  }

  for (const reminder of reminders) {
    const label = LEGACY_REMINDER_LABELS[reminder.type]
    if (!label || !reminder.isActive) continue
    add({ content: label, freq: 'daily', time: reminder.time }, 'active')
  }

  return { tasks, skipped }
}

/** 迁移一个用户：已迁移则跳过；dryRun 只计算不写入。 */
export async function migrateUserPlans(userId, { dryRun = false, now = new Date() } = {}) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { plansMigratedAt: true } })
    if (!user || user.plansMigratedAt) return { userId, skipped: true, created: 0, invalid: 0 }

    if (!dryRun) {
      // 条件更新在事务内领取用户；并发者等待行锁后重查条件，插入失败则标记一起回滚。
      const claimed = await tx.user.updateMany({ where: { id: userId, plansMigratedAt: null }, data: { plansMigratedAt: now } })
      if (claimed.count === 0) return { userId, skipped: true, created: 0, invalid: 0 }
    }

    const [todos, countdowns, habits, reminders] = await Promise.all([
      tx.todo.findMany({ where: { userId }, select: { content: true, dueDate: true, dueTime: true, isDone: true } }),
      tx.countdown.findMany({ where: { userId }, select: { title: true, targetDate: true } }),
      tx.habit.findMany({ where: { userId }, select: { name: true, archivedAt: true } }),
      tx.reminder.findMany({ where: { userId }, select: { type: true, time: true, isActive: true } }),
    ])
    const { tasks, skipped: invalid } = planTasks({ todos, countdowns, habits, reminders }, now)
    if (dryRun) return { userId, skipped: false, created: tasks.length, invalid, dryRun: true }

    if (tasks.length > 0) {
      await tx.scheduledReminder.createMany({ data: tasks.map((task) => ({ userId, ...task })) })
    }
    return { userId, skipped: false, created: tasks.length, invalid }
  })
}

/** 迁移全部用户（逐个事务，互不影响）；返回计数汇总。 */
export async function migrateAllUsers({ dryRun = false, now = new Date() } = {}) {
  const users = await prisma.user.findMany({ where: { plansMigratedAt: null }, select: { id: true } })
  const summary = { users: users.length, migrated: 0, tasks: 0, invalid: 0, failed: 0, dryRun }
  for (const { id } of users) {
    try {
      // eslint-disable-next-line no-await-in-loop -- 逐用户事务，失败只影响该用户
      const result = await migrateUserPlans(id, { dryRun, now })
      if (!result.skipped) {
        summary.migrated += 1
        summary.tasks += result.created
        summary.invalid += result.invalid
      }
    } catch (error) {
      summary.failed += 1
      logger.error('安排迁移失败', { userId: id, error: error.message })
    }
  }
  logger.info('安排迁移完成', summary)
  return summary
}
