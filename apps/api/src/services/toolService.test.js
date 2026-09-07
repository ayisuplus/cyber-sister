import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  todoFindMany: vi.fn(),
  todoCreate: vi.fn(),
  todoUpdate: vi.fn(),
  todoFindFirst: vi.fn(),
  todoDelete: vi.fn(),
  countdownFindMany: vi.fn(),
  countdownCreate: vi.fn(),
  countdownFindFirst: vi.fn(),
  countdownDelete: vi.fn(),
  periodFindMany: vi.fn(),
  periodCreate: vi.fn(),
  reminderFindMany: vi.fn(),
  reminderFindFirst: vi.fn(),
  reminderUpdate: vi.fn(),
  reminderUpsert: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    todo: {
      findMany: db.todoFindMany,
      create: db.todoCreate,
      update: db.todoUpdate,
      findFirst: db.todoFindFirst,
      delete: db.todoDelete,
    },
    countdown: {
      findMany: db.countdownFindMany,
      create: db.countdownCreate,
      findFirst: db.countdownFindFirst,
      delete: db.countdownDelete,
    },
    periodRecord: { findMany: db.periodFindMany, create: db.periodCreate },
    reminder: {
      findMany: db.reminderFindMany,
      findFirst: db.reminderFindFirst,
      update: db.reminderUpdate,
      upsert: db.reminderUpsert,
    },
  },
}))

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  createCountdown,
  createPeriodRecord,
  createTodo,
  deleteCountdown,
  deleteTodo,
  listCountdowns,
  listPeriodRecords,
  listReminders,
  listTodos,
  updateReminder,
  updateTodo,
} from './toolService.js'

beforeEach(() => vi.clearAllMocks())

describe('待办', () => {
  it('按创建时间倒序列出用户待办', async () => {
    db.todoFindMany.mockResolvedValue([{ id: 't1' }])
    const result = await listTodos('u1')
    expect(db.todoFindMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: { createdAt: 'desc' },
    })
    expect(result).toEqual([{ id: 't1' }])
  })

  it('创建待办时解析截止日期，缺省为 null', async () => {
    db.todoCreate.mockImplementation(({ data }) => Promise.resolve({ id: 't1', ...data }))

    const withDate = await createTodo('u1', { content: '买花', dueDate: '2026-09-01' })
    expect(withDate.dueDate).toEqual(new Date('2026-09-01'))

    const withoutDate = await createTodo('u1', { content: '买花' })
    expect(withoutDate.dueDate).toBeNull()
  })

  it('创建日程可带时间；无日期带时间或格式非法都拒绝', async () => {
    db.todoCreate.mockImplementation(({ data }) => Promise.resolve({ id: 't2', ...data }))

    const withTime = await createTodo('u1', { content: '复诊', dueDate: '2026-09-06', dueTime: '09:30' })
    expect(withTime.dueTime).toBe('09:30')
    expect(withTime.dueDate).toEqual(new Date('2026-09-06'))

    await expect(createTodo('u1', { content: '复诊', dueTime: '09:30' })).rejects.toMatchObject({
      statusCode: 400,
      message: '设置时间前请先选择日期',
    })
    await expect(createTodo('u1', { content: '复诊', dueDate: '2026-09-06', dueTime: '25:00' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(createTodo('u1', { content: '复诊', dueDate: '下周二' })).rejects.toMatchObject({ statusCode: 400 })
  })
  it('待办内容必须为 1 到 500 个字符', async () => {
    db.todoCreate.mockImplementation(({ data }) => Promise.resolve({ id: 't1', ...data }))

    await expect(createTodo('u1', { content: '   ' })).rejects.toMatchObject({
      statusCode: 400,
      message: '待办内容必须为1到500个字符',
    })
    await expect(createTodo('u1', { content: 'x'.repeat(501) })).rejects.toMatchObject({
      statusCode: 400,
    })
    await expect(createTodo('u1', { content: 12345 })).rejects.toMatchObject({ statusCode: 400 })
    expect(db.todoCreate).not.toHaveBeenCalled()

    const trimmed = await createTodo('u1', { content: '  买花  ' })
    expect(trimmed.content).toBe('买花')
  })

  it('更新待办时内容同样受长度校验', async () => {
    db.todoFindFirst.mockResolvedValue({ id: 't1', userId: 'u1' })
    await expect(updateTodo('u1', 't1', { content: 'x'.repeat(501) })).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(db.todoUpdate).not.toHaveBeenCalled()
  })

  it('只更新显式传入的字段', async () => {
    db.todoFindFirst.mockResolvedValue({ id: 't1', userId: 'u1' })
    db.todoUpdate.mockImplementation(({ data }) => Promise.resolve({ id: 't1', ...data }))

    await updateTodo('u1', 't1', { isDone: true })
    expect(db.todoUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { isDone: true },
    })

    await updateTodo('u1', 't1', { content: '改名', dueDate: null })
    expect(db.todoUpdate).toHaveBeenLastCalledWith({
      where: { id: 't1' },
      data: { content: '改名', dueDate: null },
    })
  })

  it('更新日程时间：无日期的既有日程不能补时间', async () => {
    db.todoFindFirst.mockResolvedValue({ id: 't1', userId: 'u1', dueDate: null })
    await expect(updateTodo('u1', 't1', { dueTime: '08:00' })).rejects.toMatchObject({
      statusCode: 400,
      message: '设置时间前请先选择日期',
    })
    expect(db.todoUpdate).not.toHaveBeenCalled()

    db.todoFindFirst.mockResolvedValue({ id: 't1', userId: 'u1', dueDate: new Date('2026-09-06') })
    db.todoUpdate.mockImplementation(({ data }) => Promise.resolve({ id: 't1', ...data }))
    await updateTodo('u1', 't1', { dueTime: '08:00' })
    expect(db.todoUpdate).toHaveBeenCalledWith({ where: { id: 't1' }, data: { dueTime: '08:00' } })
    await updateTodo('u1', 't1', { dueTime: '' })
    expect(db.todoUpdate).toHaveBeenLastCalledWith({ where: { id: 't1' }, data: { dueTime: null } })
  })

  it('更新他人待办返回 404 且不写库', async () => {
    db.todoFindFirst.mockResolvedValue(null)
    await expect(updateTodo('u2', 't1', { isDone: true })).rejects.toMatchObject({
      statusCode: 404,
      message: '日程不存在',
    })
    expect(db.todoUpdate).not.toHaveBeenCalled()
  })

  it('删除待办前校验归属', async () => {
    db.todoFindFirst.mockResolvedValue({ id: 't1', userId: 'u1' })
    await deleteTodo('u1', 't1')
    expect(db.todoDelete).toHaveBeenCalledWith({ where: { id: 't1' } })

    db.todoFindFirst.mockResolvedValue(null)
    await expect(deleteTodo('u2', 't1')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('倒数日', () => {
  it('按目标日期升序列出', async () => {
    db.countdownFindMany.mockResolvedValue([])
    await listCountdowns('u1')
    expect(db.countdownFindMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: { targetDate: 'asc' },
    })
  })

  it('创建时把目标日期转为 Date', async () => {
    db.countdownCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'c1', ...data }))
    const result = await createCountdown('u1', { title: '纪念日', targetDate: '2026-12-31' })
    expect(result.targetDate).toEqual(new Date('2026-12-31'))
  })

  it('删除前校验归属', async () => {
    db.countdownFindFirst.mockResolvedValue({ id: 'c1', userId: 'u1' })
    await deleteCountdown('u1', 'c1')
    expect(db.countdownDelete).toHaveBeenCalledWith({ where: { id: 'c1' } })

    db.countdownFindFirst.mockResolvedValue(null)
    await expect(deleteCountdown('u2', 'c1')).rejects.toMatchObject({
      statusCode: 404,
      message: '倒数日不存在',
    })
  })
})

describe('经期记录', () => {
  it('按开始日期倒序列出', async () => {
    db.periodFindMany.mockResolvedValue([])
    await listPeriodRecords('u1')
    expect(db.periodFindMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: { startDate: 'desc' },
    })
  })

  it('创建时默认周期 28 天，结束日期缺省为 null', async () => {
    db.periodCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'p1', ...data }))

    const minimal = await createPeriodRecord('u1', { startDate: '2026-08-01' })
    expect(minimal.cycleDays).toBe(28)
    expect(minimal.endDate).toBeNull()

    const full = await createPeriodRecord('u1', {
      startDate: '2026-08-01',
      endDate: '2026-08-05',
      cycleDays: 30,
    })
    expect(full.cycleDays).toBe(30)
    expect(full.endDate).toEqual(new Date('2026-08-05'))
  })
  it('周期天数必须是 20 到 45 的整数', async () => {
    for (const cycleDays of [19, 46, 28.5, '30']) {
      await expect(createPeriodRecord('u1', { startDate: '2026-08-01', cycleDays }))
        .rejects.toMatchObject({
          statusCode: 400,
          message: '周期天数必须是20到45之间的整数',
        })
    }
    expect(db.periodCreate).not.toHaveBeenCalled()
  })
})

describe('提醒', () => {
  it('已有记录时按创建时间倒序列出，不重复物化', async () => {
    db.reminderFindMany.mockResolvedValue([{ id: 'r1', type: 'water' }])
    const result = await listReminders('u1')
    expect(db.reminderFindMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: { createdAt: 'desc' },
    })
    expect(result).toEqual([{ id: 'r1', type: 'water' }])
    expect(db.reminderUpsert).not.toHaveBeenCalled()
  })

  it('首次读取物化三条默认提醒且默认关闭', async () => {
    db.reminderFindMany.mockResolvedValue([])
    db.reminderUpsert.mockImplementation(({ create }) => Promise.resolve({ id: `r-${create.type}`, ...create }))
    const result = await listReminders('u1')
    expect(db.reminderUpsert).toHaveBeenCalledTimes(3)
    expect(db.reminderUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_type: { userId: 'u1', type: 'period' } },
      create: expect.objectContaining({ userId: 'u1', type: 'period', isActive: false }),
      update: {},
    }))
    expect(result.map((r) => r.type).sort()).toEqual(['period', 'sleep', 'water'])
    expect(result.every((r) => r.isActive === false)).toBe(true)
  })

  it('只更新显式传入的字段且校验归属', async () => {
    db.reminderFindFirst.mockResolvedValue({ id: 'r1', userId: 'u1' })
    db.reminderUpdate.mockImplementation(({ data }) => Promise.resolve({ id: 'r1', ...data }))

    await updateReminder('u1', 'r1', { time: '08:00' })
    expect(db.reminderUpdate).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { time: '08:00' },
    })

    await updateReminder('u1', 'r1', { isActive: false })
    expect(db.reminderUpdate).toHaveBeenLastCalledWith({
      where: { id: 'r1' },
      data: { isActive: false },
    })

    db.reminderFindFirst.mockResolvedValue(null)
    await expect(updateReminder('u2', 'r1', { time: '09:00' })).rejects.toMatchObject({
      statusCode: 404,
      message: '提醒不存在',
    })
  })
  it('提醒时间必须是 HH:mm 格式', async () => {
    db.reminderFindFirst.mockResolvedValue({ id: 'r1', userId: 'u1' })
    for (const time of ['8:00', '08:00:00', '八点', 800]) {
      await expect(updateReminder('u1', 'r1', { time })).rejects.toMatchObject({
        statusCode: 400,
        message: '提醒时间必须是 HH:mm 格式',
      })
    }
    expect(db.reminderUpdate).not.toHaveBeenCalled()
  })
})
