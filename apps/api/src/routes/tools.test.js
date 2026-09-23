import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const service = vi.hoisted(() => ({
  listPeriodRecords: vi.fn(),
  createPeriodRecord: vi.fn(),
  getPeriodSummary: vi.fn(),
  updatePeriodRecord: vi.fn(),
  deletePeriodRecord: vi.fn(),
  getPeriodConsent: vi.fn(),
  setPeriodConsent: vi.fn(),
  getPeriodTone: vi.fn(),
  setPeriodTone: vi.fn(),
}))

vi.mock('../services/periodService.js', () => service)
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import toolsRoutes from './tools.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', toolsRoutes)
app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }))

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode })

beforeEach(() => vi.clearAllMocks())

it('周期摘要和修正删除接口始终使用鉴权身份，透传校验失败', async () => {
  service.getPeriodSummary.mockResolvedValue({ nextDate: '2026-09-19', daysUntil: 18 })
  expect((await request(app).get('/period/summary?today=2026-09-01&userId=attacker')).body.daysUntil).toBe(18)
  expect(service.getPeriodSummary).toHaveBeenCalledWith('user-1', '2026-09-01')
  service.updatePeriodRecord.mockResolvedValue({ id: 'p1' })
  expect((await request(app).put('/period/p1').send({ endDate: '2026-09-05' })).status).toBe(200)
  expect(service.updatePeriodRecord).toHaveBeenCalledWith('user-1', 'p1', { endDate: '2026-09-05' })
  expect((await request(app).delete('/period/p1')).body).toEqual({ success: true })
  expect(service.deletePeriodRecord).toHaveBeenCalledWith('user-1', 'p1')
  service.updatePeriodRecord.mockRejectedValue(httpError('日期不存在', 400))
  expect((await request(app).put('/period/p1').send({ startDate: 'bad' })).status).toBe(400)
})

describe('日程、倒数日与旧提醒已由「安排」替代', () => {
  it.each([
    ['get', '/todos'], ['post', '/todos'], ['put', '/todos/t1'], ['delete', '/todos/t1'],
    ['get', '/countdowns'], ['post', '/countdowns'], ['delete', '/countdowns/c1'],
    ['get', '/reminders'], ['put', '/reminders/r1'],
  ])('%s %s 不再提供', async (method, path) => {
    expect((await request(app)[method](path).send({})).status).toBe(404)
  })
})

describe('经期路由', () => {
  it('列出经期记录，异常返回 500', async () => {
    service.listPeriodRecords.mockResolvedValue([{ id: 'p1' }])
    const ok = await request(app).get('/period')
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual([{ id: 'p1' }])

    service.listPeriodRecords.mockRejectedValue(new Error('db down'))
    expect((await request(app).get('/period')).status).toBe(500)
  })

  it('创建经期记录要求合法开始日期', async () => {
    expect((await request(app).post('/period').send({})).status).toBe(400)
    expect((await request(app).post('/period').send({ startDate: 'bad' })).status).toBe(400)
    expect(service.createPeriodRecord).not.toHaveBeenCalled()

    service.createPeriodRecord.mockResolvedValue({ id: 'p1' })
    const ok = await request(app).post('/period').send({ startDate: '2026-08-01' })
    expect(ok.status).toBe(200)
    expect(service.createPeriodRecord).toHaveBeenCalledWith('user-1', { startDate: '2026-08-01' })

    service.createPeriodRecord.mockRejectedValue(new Error('db down'))
    const fail = await request(app).post('/period').send({ startDate: '2026-08-01' })
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '创建经期记录失败' })
  })
})

describe('经期单独同意路由', () => {
  it('读取与更新只作用于当前用户，且不会被当成记录 id', async () => {
    service.getPeriodConsent.mockResolvedValue({ accepted: false, updatedAt: null })
    const read = await request(app).get('/period/consent')
    expect(read.body).toEqual({ accepted: false, updatedAt: null })
    expect(service.getPeriodConsent).toHaveBeenCalledWith('user-1')

    service.setPeriodConsent.mockResolvedValue({ accepted: true, updatedAt: '2026-09-19T00:00:00.000Z' })
    const saved = await request(app).put('/period/consent').send({ accepted: true, userId: 'attacker' })
    expect(saved.status).toBe(200)
    expect(service.setPeriodConsent).toHaveBeenCalledWith('user-1', true)
    expect(service.updatePeriodRecord).not.toHaveBeenCalled()
  })

  it('「顾及周期」单独读写，只作用于当前用户，也不会被当成记录 id', async () => {
    service.getPeriodTone.mockResolvedValue({ enabled: false, updatedAt: null })
    expect((await request(app).get('/period/tone')).body).toEqual({ enabled: false, updatedAt: null })
    expect(service.getPeriodTone).toHaveBeenCalledWith('user-1')

    service.setPeriodTone.mockResolvedValue({ enabled: true, updatedAt: '2026-09-21T00:00:00.000Z' })
    const saved = await request(app).put('/period/tone').send({ enabled: true, userId: 'attacker' })
    expect(saved.status).toBe(200)
    expect(service.setPeriodTone).toHaveBeenCalledWith('user-1', true)
    expect(service.updatePeriodRecord).not.toHaveBeenCalled()
  })

  it('未同意时新增记录返回 403 与稳定 code', async () => {
    service.createPeriodRecord.mockRejectedValue(Object.assign(new Error('需要先同意'), { statusCode: 403, code: 'PERIOD_CONSENT_REQUIRED' }))
    const response = await request(app).post('/period').send({ startDate: '2026-08-01' })
    expect(response.status).toBe(403)
    expect(response.body).toEqual({ error: '需要先同意', code: 'PERIOD_CONSENT_REQUIRED' })
  })
})
