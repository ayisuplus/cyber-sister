import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  periodFindMany: vi.fn(),
  periodCreate: vi.fn(),
  periodFindFirst: vi.fn(),
  periodUpdate: vi.fn(),
  periodDelete: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    periodRecord: { findMany: db.periodFindMany, create: db.periodCreate, findFirst: db.periodFindFirst, update: db.periodUpdate, delete: db.periodDelete },
  },
}))

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  createPeriodRecord,
  deletePeriodRecord,
  getPeriodSummary,
  listPeriodRecords,
  updatePeriodRecord,
} from './periodService.js'

beforeEach(() => vi.clearAllMocks())

describe('经期记录', () => {
  it('服务端摘要使用拥有者的最新记录并按指定日历日计数', async () => {
    db.periodFindFirst.mockResolvedValue({ id: 'p1', startDate: new Date('2026-08-22'), cycleDays: 28 })
    await expect(getPeriodSummary('u1', '2026-09-01')).resolves.toEqual({ asOf: '2026-09-01', nextDate: '2026-09-19', daysUntil: 18, basedOnRecordId: 'p1', source: 'server_calculation' })
    expect(db.periodFindFirst).toHaveBeenCalledWith({ where: { userId: 'u1' }, orderBy: { startDate: 'desc' } })
    expect((await getPeriodSummary('u1', '2026-10-01')).daysUntil).toBe(0)
    db.periodFindFirst.mockResolvedValue(null)
    expect(await getPeriodSummary('u2', '2026-09-01')).toMatchObject({ nextDate: null, daysUntil: null })
  })

  it('拒绝不存在的日期与倒置范围', async () => {
    await expect(createPeriodRecord('u1', { startDate: '2026-02-30' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(createPeriodRecord('u1', { startDate: '2026-09-12', endDate: '2026-09-11' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(getPeriodSummary('u1', 'not-a-day')).rejects.toMatchObject({ statusCode: 400 })
    expect(db.periodCreate).not.toHaveBeenCalled()
  })

  it('修改和删除先校验归属；允许补写结束日期但不能倒置范围', async () => {
    const record = { id: 'p1', startDate: new Date('2026-09-01'), endDate: null, cycleDays: 28 }
    db.periodFindFirst.mockResolvedValue(record)
    db.periodUpdate.mockImplementation(({ data }) => ({ id: 'p1', ...data }))
    expect(await updatePeriodRecord('u1', 'p1', { endDate: '2026-09-05' })).toMatchObject({ endDate: new Date('2026-09-05') })
    expect(db.periodFindFirst).toHaveBeenCalledWith({ where: { id: 'p1', userId: 'u1' } })
    await expect(updatePeriodRecord('u1', 'p1', { endDate: '2026-08-31' })).rejects.toMatchObject({ statusCode: 400 })
    await deletePeriodRecord('u1', 'p1')
    expect(db.periodDelete).toHaveBeenCalledWith({ where: { id: 'p1' } })
    db.periodFindFirst.mockResolvedValue(null)
    await expect(updatePeriodRecord('u2', 'p1', { cycleDays: 30 })).rejects.toMatchObject({ statusCode: 404 })
    await expect(deletePeriodRecord('u2', 'p1')).rejects.toMatchObject({ statusCode: 404 })
    expect(db.periodDelete).toHaveBeenCalledTimes(1)
  })

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
