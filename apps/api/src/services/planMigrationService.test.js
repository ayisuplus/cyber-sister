import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userFindMany: vi.fn(),
  userUpdate: vi.fn(),
  userClaim: vi.fn(),
  todoFindMany: vi.fn(),
  countdownFindMany: vi.fn(),
  habitFindMany: vi.fn(),
  reminderFindMany: vi.fn(),
  taskCreateMany: vi.fn(),
}))

vi.mock('../prisma/client.js', () => {
  const client = {
    user: { findUnique: db.userFindUnique, findMany: db.userFindMany, update: db.userUpdate, updateMany: db.userClaim },
    todo: { findMany: db.todoFindMany },
    countdown: { findMany: db.countdownFindMany },
    habit: { findMany: db.habitFindMany },
    reminder: { findMany: db.reminderFindMany },
    scheduledReminder: { createMany: db.taskCreateMany },
  }
  client.$transaction = vi.fn((run) => run(client))
  return { default: client }
})
vi.mock('../utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { migrateAllUsers, migrateUserPlans, planTasks } from './planMigrationService.js'

const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi)
const utcDay = (y, mo, d) => new Date(Date.UTC(y, mo - 1, d))
const NOW = local(2026, 9, 15, 12, 0)

describe('planTasks：旧数据到安排的映射', () => {
  it('未来的日程成为一次性安排，保留原时间；没时间的用 09:00', () => {
    const { tasks } = planTasks({
      todos: [
        { content: '交房租', dueDate: utcDay(2026, 9, 20), dueTime: '18:30', isDone: false },
        { content: '买花', dueDate: utcDay(2026, 9, 21), dueTime: null, isDone: false },
      ],
    }, NOW)

    expect(tasks).toMatchObject([
      { content: '交房租', freq: 'once', time: '18:30', fireAt: local(2026, 9, 20, 18, 30), status: 'active' },
      { content: '买花', freq: 'once', time: '09:00', fireAt: local(2026, 9, 21, 9, 0), status: 'active' },
    ])
  })

  it('已过期或没有日期的日程成为已暂停的安排，不会一迁移就批量到期', () => {
    const { tasks } = planTasks({
      todos: [
        { content: '上周的事', dueDate: utcDay(2026, 9, 10), dueTime: null, isDone: false },
        { content: '有空再做', dueDate: null, dueTime: null, isDone: false },
      ],
    }, NOW)

    expect(tasks.map((task) => task.status)).toEqual(['paused', 'paused'])
    expect(tasks[1].fireAt).toEqual(local(2026, 9, 15, 9, 0))
  })

  it('已完成的日程、已过去的倒数日、已归档的习惯、关闭的与经期提醒都不迁移', () => {
    const { tasks } = planTasks({
      todos: [{ content: '做完了', dueDate: utcDay(2026, 9, 20), dueTime: null, isDone: true }],
      countdowns: [{ title: '已经过去', targetDate: utcDay(2026, 9, 1) }],
      habits: [{ name: '旧习惯', archivedAt: local(2026, 8, 1) }],
      reminders: [
        { type: 'water', time: '10:00', isActive: false },
        { type: 'period', time: '09:00', isActive: true },
      ],
    }, NOW)

    expect(tasks).toEqual([])
  })

  it('未来的倒数日、未归档的习惯、开启的喝水/睡觉提醒分别成为对应安排', () => {
    const { tasks } = planTasks({
      countdowns: [{ title: '面试', targetDate: utcDay(2026, 9, 18) }],
      habits: [{ name: '喝八杯水', archivedAt: null }],
      reminders: [{ type: 'sleep', time: '23:00', isActive: true }],
    }, NOW)

    expect(tasks).toMatchObject([
      { content: '面试', freq: 'once', fireAt: local(2026, 9, 18, 9, 0), status: 'active' },
      { content: '打卡：喝八杯水', freq: 'daily', time: '21:00', status: 'active' },
      { content: '该睡觉了', freq: 'daily', time: '23:00', status: 'active' },
    ])
  })

  it('超长日程截断到 200 字；单条不合规只跳过并计数', () => {
    const { tasks, skipped } = planTasks({
      todos: [{ content: '长'.repeat(500), dueDate: utcDay(2026, 9, 20), dueTime: null, isDone: false }],
      reminders: [{ type: 'water', time: '99:99', isActive: true }],
    }, NOW)

    expect(tasks).toHaveLength(1)
    expect(tasks[0].content).toHaveLength(200)
    expect(tasks[0].content.endsWith('…')).toBe(true)
    expect(skipped).toBe(1)
  })
})

describe('migrateUserPlans / migrateAllUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.userFindUnique.mockResolvedValue({ plansMigratedAt: null })
    db.userClaim.mockResolvedValue({ count: 1 })
    db.todoFindMany.mockResolvedValue([{ content: '交房租', dueDate: utcDay(2026, 9, 20), dueTime: '18:30', isDone: false }])
    db.countdownFindMany.mockResolvedValue([])
    db.habitFindMany.mockResolvedValue([{ name: '散步', archivedAt: null }])
    db.reminderFindMany.mockResolvedValue([])
    db.taskCreateMany.mockResolvedValue({ count: 2 })
  })

  it('写入安排并打上迁移标记', async () => {
    const result = await migrateUserPlans('u1', { now: NOW })

    expect(result).toEqual({ userId: 'u1', skipped: false, created: 2, invalid: 0 })
    const { data } = db.taskCreateMany.mock.calls[0][0]
    expect(data.every((task) => task.userId === 'u1')).toBe(true)
    expect(db.userClaim).toHaveBeenCalledWith({ where: { id: 'u1', plansMigratedAt: null }, data: { plansMigratedAt: NOW } })
    expect(db.userClaim.mock.invocationCallOrder[0]).toBeLessThan(db.taskCreateMany.mock.invocationCallOrder[0])
  })

  it('已迁移的用户直接跳过，保证可重复执行', async () => {
    db.userFindUnique.mockResolvedValue({ plansMigratedAt: local(2026, 9, 15) })

    expect(await migrateUserPlans('u1', { now: NOW })).toMatchObject({ skipped: true, created: 0 })
    expect(db.taskCreateMany).not.toHaveBeenCalled()
    expect(db.userUpdate).not.toHaveBeenCalled()
    expect(db.userClaim).not.toHaveBeenCalled()
  })

  it('dry-run 只计算条数，不写任何东西', async () => {
    expect(await migrateUserPlans('u1', { dryRun: true, now: NOW })).toMatchObject({ created: 2, dryRun: true })
    expect(db.taskCreateMany).not.toHaveBeenCalled()
    expect(db.userUpdate).not.toHaveBeenCalled()
    expect(db.userClaim).not.toHaveBeenCalled()
  })

  it('两个调用读到同一空标记时，仅成功领取者写入安排', async () => {
    db.userClaim.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    const results = await Promise.all([migrateUserPlans('u1', { now: NOW }), migrateUserPlans('u1', { now: NOW })])
    expect(results.filter(result => !result.skipped)).toHaveLength(1)
    expect(results.filter(result => result.skipped)).toHaveLength(1)
    expect(db.taskCreateMany).toHaveBeenCalledTimes(1)
  })

  it('全量迁移逐用户进行，单个用户失败不影响其他人', async () => {
    db.userFindMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }])
    db.taskCreateMany.mockRejectedValueOnce(new Error('db down')).mockResolvedValue({ count: 2 })

    const summary = await migrateAllUsers({ now: NOW })

    expect(summary).toEqual({ users: 2, migrated: 1, tasks: 2, invalid: 0, failed: 1, dryRun: false })
    expect(db.userFindMany).toHaveBeenCalledWith({ where: { plansMigratedAt: null }, select: { id: true } })
  })
})
