import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  srCreate: vi.fn(),
  srFindMany: vi.fn(),
  srFindUnique: vi.fn(),
  srFindFirst: vi.fn(),
  srUpdate: vi.fn(),
  srDelete: vi.fn(),
  rdCreate: vi.fn(),
  rdFindMany: vi.fn(),
  rdFindUnique: vi.fn(),
  rdUpdate: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    scheduledReminder: {
      create: mocks.srCreate,
      findMany: mocks.srFindMany,
      findUnique: mocks.srFindUnique,
      findFirst: mocks.srFindFirst,
      update: mocks.srUpdate,
      delete: mocks.srDelete,
    },
    reminderDelivery: {
      create: mocks.rdCreate,
      findMany: mocks.rdFindMany,
      findUnique: mocks.rdFindUnique,
      update: mocks.rdUpdate,
    },
  },
}))
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  computeNextFire,
  createScheduledReminder,
  listDueReminders,
  ackDelivery,
  deleteScheduledReminder,
  updateScheduledReminder,
} from './reminderService.js'

const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi)

describe('computeNextFire', () => {
  const after = local(2026, 9, 10, 12, 0) // 周四 12:00（2026-09-10 是周四）

  it('once 原样返回 fireAt', () => {
    const fireAt = local(2026, 9, 15, 9, 30)
    expect(computeNextFire({ freq: 'once', fireAt }, after)).toEqual(fireAt)
  })

  it('daily：今天时间未过则今天，已过则明天', () => {
    expect(computeNextFire({ freq: 'daily', time: '18:00' }, after)).toEqual(local(2026, 9, 10, 18, 0))
    expect(computeNextFire({ freq: 'daily', time: '07:30' }, after)).toEqual(local(2026, 9, 11, 7, 30))
  })

  it('weekly：今天周四在列表中但时间已过 → 下周六；否则最近的工作日', () => {
    expect(computeNextFire({ freq: 'weekly', time: '09:00', weekdays: [4, 6] }, after))
      .toEqual(local(2026, 9, 12, 9, 0)) // 周六
    expect(computeNextFire({ freq: 'weekly', time: '18:00', weekdays: [4] }, after))
      .toEqual(local(2026, 9, 10, 18, 0)) // 今天 18:00 未过
    expect(computeNextFire({ freq: 'weekly', time: '09:00', weekdays: [1, 3, 5] }, after))
      .toEqual(local(2026, 9, 11, 9, 0)) // 周五
  })

  it('monthly：本月日期已过取下月；31 号在小月夹紧到月末', () => {
    expect(computeNextFire({ freq: 'monthly', time: '08:00', monthDay: 15 }, after))
      .toEqual(local(2026, 9, 15, 8, 0))
    expect(computeNextFire({ freq: 'monthly', time: '08:00', monthDay: 5 }, after))
      .toEqual(local(2026, 10, 5, 8, 0))
    expect(computeNextFire({ freq: 'monthly', time: '08:00', monthDay: 31 }, local(2026, 1, 31, 12, 0)))
      .toEqual(local(2026, 2, 28, 8, 0)) // 2026 年 2 月 28 天
  })

  it('weekly 边界：今天刚好是当前时刻也算已过，推到下一个命中日', () => {
    const exactly = local(2026, 9, 10, 12, 0)
    expect(computeNextFire({ freq: 'weekly', time: '12:00', weekdays: [4] }, exactly))
      .toEqual(local(2026, 9, 17, 12, 0))
  })
})

describe('createScheduledReminder 校验', () => {
  beforeEach(() => vi.clearAllMocks())

  it('once：date+time 合成 fireAt 并预计算 nextFireAt', async () => {
    mocks.srCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'r1', ...data }))
    const r = await createScheduledReminder('u1', { content: '取快递', freq: 'once', date: '2026-09-12', time: '18:00' })
    expect(r.fireAt).toEqual(local(2026, 9, 12, 18, 0))
    expect(r.nextFireAt).toEqual(r.fireAt)
  })

  it('weekly 缺 weekdays 报 400；monthDay 越界报 400；内容超长报 400', () => {
    // 校验在 prisma 调用前同步抛出
    expect(() => createScheduledReminder('u1', { content: 'x', freq: 'weekly', time: '09:00' }))
      .toThrowError(expect.objectContaining({ statusCode: 400 }))
    expect(() => createScheduledReminder('u1', { content: 'x', freq: 'monthly', time: '09:00', monthDay: 32 }))
      .toThrowError(expect.objectContaining({ statusCode: 400 }))
    expect(() => createScheduledReminder('u1', { content: 'x'.repeat(201), freq: 'daily', time: '09:00' }))
      .toThrowError(expect.objectContaining({ statusCode: 400 }))
  })

  it('非法 freq / 时间格式报 400', () => {
    expect(() => createScheduledReminder('u1', { content: 'x', freq: 'hourly', time: '09:00' }))
      .toThrowError(expect.objectContaining({ statusCode: 400 }))
    expect(() => createScheduledReminder('u1', { content: 'x', freq: 'daily', time: '25:00' }))
      .toThrowError(expect.objectContaining({ statusCode: 400 }))
  })
})

describe('listDueReminders（幂等投递）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('到点提醒幂等创建投递并返回 pending 列表；撞唯一键静默复用', async () => {
    const reminder = { id: 'r1', userId: 'u1', status: 'active', nextFireAt: local(2026, 9, 10, 8, 0) }
    mocks.srFindMany.mockResolvedValue([reminder])
    mocks.rdCreate.mockRejectedValue({ code: 'P2002' }) // 并发撞键
    mocks.rdFindMany.mockResolvedValue([
      { id: 'd1', reminderId: 'r1', fireAt: reminder.nextFireAt, status: 'pending', reminder: { id: 'r1', content: '喝水', freq: 'daily', time: '08:00' } },
    ])
    const out = await listDueReminders('u1', local(2026, 9, 10, 9, 0))
    expect(mocks.rdCreate).toHaveBeenCalledWith({ data: { reminderId: 'r1', fireAt: reminder.nextFireAt } })
    expect(out).toHaveLength(1)
    expect(out[0].reminder.content).toBe('喝水')
  })
})

describe('ackDelivery', () => {
  beforeEach(() => vi.clearAllMocks())

  it('一次性提醒 ack 后置 done', async () => {
    const delivery = {
      id: 'd1', fireAt: local(2026, 9, 10, 8, 0),
      reminder: { id: 'r1', userId: 'u1', freq: 'once' },
    }
    mocks.rdFindUnique.mockResolvedValue(delivery)
    mocks.rdUpdate.mockResolvedValue({ ...delivery, status: 'shown' })
    mocks.srUpdate.mockResolvedValue({})
    await ackDelivery('d1', 'u1', 'shown')
    expect(mocks.srUpdate).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: 'done' } })
  })

  it('循环提醒 ack 后推进 nextFireAt 到下一次', async () => {
    const fireAt = local(2026, 9, 10, 8, 0) // 周四
    const delivery = {
      id: 'd1', fireAt,
      reminder: { id: 'r1', userId: 'u1', freq: 'daily', time: '08:00', weekdays: [], monthDay: null },
    }
    mocks.rdFindUnique.mockResolvedValue(delivery)
    mocks.rdUpdate.mockResolvedValue({})
    mocks.srUpdate.mockResolvedValue({})
    await ackDelivery('d1', 'u1', 'dismissed')
    expect(mocks.srUpdate).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { nextFireAt: local(2026, 9, 11, 8, 0) },
    })
  })

  it('他人投递 404；非法 action 400', async () => {
    mocks.rdFindUnique.mockResolvedValue({ id: 'd1', reminder: { userId: 'other' } })
    await expect(ackDelivery('d1', 'u1', 'shown')).rejects.toMatchObject({ statusCode: 404 })
    await expect(ackDelivery('d1', 'u1', 'noop')).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('update/delete', () => {
  beforeEach(() => vi.clearAllMocks())

  it('时间字段变化时重建并重算 nextFireAt；done 状态复活为 active', async () => {
    const current = {
      id: 'r1', userId: 'u1', content: '取快递', freq: 'daily', time: '09:00',
      weekdays: [], monthDay: null, status: 'done',
    }
    mocks.srFindFirst.mockResolvedValue(current)
    mocks.srUpdate.mockImplementation(({ data }) => Promise.resolve({ ...current, ...data }))
    const r = await updateScheduledReminder('r1', 'u1', { time: '21:00' })
    expect(r.time).toBe('21:00')
    expect(r.status).toBe('active')
    expect(mocks.srUpdate.mock.calls[0][0].data.nextFireAt instanceof Date).toBe(true)
  })

  it('删除走归属校验', async () => {
    mocks.srFindFirst.mockResolvedValue({ id: 'r1', userId: 'u1' })
    mocks.srDelete.mockResolvedValue({})
    await deleteScheduledReminder('r1', 'u1')
    expect(mocks.srDelete).toHaveBeenCalled()
  })
})
