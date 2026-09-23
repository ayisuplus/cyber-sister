import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  periodFindMany: vi.fn(),
  periodCreate: vi.fn(),
  periodFindFirst: vi.fn(),
  periodUpdate: vi.fn(),
  periodDelete: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    periodRecord: { findMany: db.periodFindMany, create: db.periodCreate, findFirst: db.periodFindFirst, update: db.periodUpdate, delete: db.periodDelete },
    user: { findUnique: db.userFindUnique, update: db.userUpdate },
  },
}))

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  assertPeriodConsent,
  createPeriodRecord,
  deletePeriodRecord,
  getPeriodConsent,
  getPeriodSummary,
  getPeriodTone,
  listPeriodRecords,
  setPeriodConsent,
  setPeriodTone,
  updatePeriodRecord,
} from './periodService.js'

beforeEach(() => {
  vi.clearAllMocks()
  db.userFindUnique.mockResolvedValue({ periodConsentAt: new Date('2026-09-01T00:00:00Z') })
})

describe('经期单独同意', () => {
  it('未同意时不能新增或修改，查看与删除不受限', async () => {
    db.userFindUnique.mockResolvedValue({ periodConsentAt: null })
    await expect(createPeriodRecord('u1', { startDate: '2026-08-01' })).rejects.toMatchObject({ statusCode: 403, code: 'PERIOD_CONSENT_REQUIRED' })
    await expect(updatePeriodRecord('u1', 'p1', { cycleDays: 30 })).rejects.toMatchObject({ statusCode: 403, code: 'PERIOD_CONSENT_REQUIRED' })
    expect(db.periodCreate).not.toHaveBeenCalled()
    expect(db.periodUpdate).not.toHaveBeenCalled()

    db.periodFindMany.mockResolvedValue([])
    await expect(listPeriodRecords('u1')).resolves.toEqual([])
    db.periodFindFirst.mockResolvedValue({ id: 'p1' })
    await deletePeriodRecord('u1', 'p1')
    expect(db.periodDelete).toHaveBeenCalledWith({ where: { id: 'p1' } })
  })

  it('同意与撤回写入时间，读取只返回布尔值和时间', async () => {
    db.userUpdate.mockResolvedValue({})
    const accepted = await setPeriodConsent('u1', true)
    expect(accepted.accepted).toBe(true)
    expect(db.userUpdate).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { periodConsentAt: expect.any(Date) } })
    expect(await setPeriodConsent('u1', false)).toEqual({ accepted: false, updatedAt: null })
    expect(db.userUpdate).toHaveBeenLastCalledWith({ where: { id: 'u1' }, data: { periodConsentAt: null, periodToneAt: null } })
    await expect(setPeriodConsent('u1', 'yes')).rejects.toMatchObject({ statusCode: 400 })

    expect(await getPeriodConsent('u1')).toEqual({ accepted: true, updatedAt: new Date('2026-09-01T00:00:00Z') })
    expect(db.userFindUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { periodConsentAt: true } })
    await expect(assertPeriodConsent('u1')).resolves.toBeUndefined()
    db.userFindUnique.mockResolvedValue(null)
    await expect(getPeriodConsent('ghost')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('聊天时让她顾及你的周期', () => {
  it('没有记录同意就打不开；打开与关闭写入时间，参数必须是布尔值', async () => {
    db.userUpdate.mockResolvedValue({})
    db.userFindUnique.mockResolvedValue({ periodConsentAt: null })
    await expect(setPeriodTone('u1', true)).rejects.toMatchObject({ statusCode: 403, code: 'PERIOD_CONSENT_REQUIRED' })
    expect(db.userUpdate).not.toHaveBeenCalled()
    // 关掉永远可以
    expect(await setPeriodTone('u1', false)).toEqual({ enabled: false, updatedAt: null })
    expect(db.userUpdate).toHaveBeenLastCalledWith({ where: { id: 'u1' }, data: { periodToneAt: null } })

    db.userFindUnique.mockResolvedValue({ periodConsentAt: new Date('2026-09-01T00:00:00Z') })
    expect((await setPeriodTone('u1', true)).enabled).toBe(true)
    expect(db.userUpdate).toHaveBeenLastCalledWith({ where: { id: 'u1' }, data: { periodToneAt: expect.any(Date) } })
    await expect(setPeriodTone('u1', 'yes')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('读取时记录同意不在就算关着', async () => {
    const at = new Date('2026-09-20T00:00:00Z')
    db.userFindUnique.mockResolvedValue({ periodConsentAt: at, periodToneAt: at })
    expect(await getPeriodTone('u1')).toEqual({ enabled: true, updatedAt: at })
    expect(db.userFindUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { periodConsentAt: true, periodToneAt: true } })
    db.userFindUnique.mockResolvedValue({ periodConsentAt: null, periodToneAt: at })
    expect(await getPeriodTone('u1')).toEqual({ enabled: false, updatedAt: null })
    db.userFindUnique.mockResolvedValue(null)
    await expect(getPeriodTone('ghost')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('经期记录', () => {
  it('服务端摘要使用拥有者的最新记录并按指定日历日计数', async () => {
    db.periodFindFirst.mockResolvedValue({ id: 'p1', startDate: new Date('2026-08-22'), cycleDays: 28 })
    await expect(getPeriodSummary('u1', '2026-09-01')).resolves.toEqual({ asOf: '2026-09-01', nextDate: '2026-09-19', daysUntil: 18, overdueDays: 0, basedOnRecordId: 'p1', source: 'server_calculation' })
    expect(db.periodFindFirst).toHaveBeenCalledWith({ where: { userId: 'u1' }, orderBy: { startDate: 'desc' } })
    // 过了预计的日子：还有 0 天，同时如实写晚了几天
    expect(await getPeriodSummary('u1', '2026-10-01')).toMatchObject({ daysUntil: 0, overdueDays: 12 })
    expect(await getPeriodSummary('u1', '2026-09-19')).toMatchObject({ daysUntil: 0, overdueDays: 0 })
    db.periodFindFirst.mockResolvedValue(null)
    expect(await getPeriodSummary('u2', '2026-09-01')).toMatchObject({ nextDate: null, daysUntil: null, overdueDays: null })
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
