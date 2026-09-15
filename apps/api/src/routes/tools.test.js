import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const service = vi.hoisted(() => ({
  listPeriodRecords: vi.fn(),
  createPeriodRecord: vi.fn(),
  getPeriodSummary: vi.fn(),
  updatePeriodRecord: vi.fn(),
  deletePeriodRecord: vi.fn(),
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

describe('天气路由', () => {
  it('返回固定的 mock 天气数据', async () => {
    const response = await request(app).get('/weather')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      city: '上海',
      temp: 32,
      condition: '多云',
      humidity: 65,
      tip: '明天降温，记得穿外套',
    })
  })
})
