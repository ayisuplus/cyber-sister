import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const service = vi.hoisted(() => ({
  listTodos: vi.fn(),
  createTodo: vi.fn(),
  updateTodo: vi.fn(),
  deleteTodo: vi.fn(),
  listCountdowns: vi.fn(),
  createCountdown: vi.fn(),
  deleteCountdown: vi.fn(),
  listPeriodRecords: vi.fn(),
  createPeriodRecord: vi.fn(),
  listReminders: vi.fn(),
  updateReminder: vi.fn(),
}))

vi.mock('../services/toolService.js', () => service)
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

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode })

beforeEach(() => vi.clearAllMocks())

describe('待办路由', () => {
  it('列出待办并透传 service 错误', async () => {
    service.listTodos.mockResolvedValue([{ id: 't1' }])
    const ok = await request(app).get('/todos')
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual([{ id: 't1' }])
    expect(service.listTodos).toHaveBeenCalledWith('user-1')

    service.listTodos.mockRejectedValue(new Error('db down'))
    const fail = await request(app).get('/todos')
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '获取待办列表失败' })
  })

  it('创建待办要求内容非空', async () => {
    const bad = await request(app).post('/todos').send({})
    expect(bad.status).toBe(400)
    expect(service.createTodo).not.toHaveBeenCalled()

    service.createTodo.mockResolvedValue({ id: 't1', content: '买花' })
    const ok = await request(app).post('/todos').send({ content: '买花' })
    expect(ok.status).toBe(200)
    expect(ok.body.content).toBe('买花')
  })

  it('更新待办透传 404 状态码与消息', async () => {
    service.updateTodo.mockRejectedValue(httpError('待办不存在', 404))
    const response = await request(app).put('/todos/t1').send({ isDone: true })
    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: '待办不存在' })

    service.updateTodo.mockResolvedValue({ id: 't1', isDone: true })
    const ok = await request(app).put('/todos/t1').send({ isDone: true })
    expect(ok.status).toBe(200)
    expect(service.updateTodo).toHaveBeenCalledWith('user-1', 't1', { isDone: true })
  })

  it('删除待办成功返回 success，失败按状态码透传', async () => {
    service.deleteTodo.mockResolvedValue(undefined)
    const ok = await request(app).delete('/todos/t1')
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ success: true })

    service.deleteTodo.mockRejectedValue(httpError('待办不存在', 404))
    const missing = await request(app).delete('/todos/t1')
    expect(missing.status).toBe(404)
  })
})

describe('倒数日路由', () => {
  it('列出倒数日，service 异常返回 500', async () => {
    service.listCountdowns.mockResolvedValue([])
    expect((await request(app).get('/countdowns')).status).toBe(200)

    service.listCountdowns.mockRejectedValue(new Error('db down'))
    const fail = await request(app).get('/countdowns')
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '获取倒数日列表失败' })
  })

  it('创建倒数日要求标题与合法目标日期', async () => {
    expect((await request(app).post('/countdowns').send({ targetDate: '2026-12-31' })).status).toBe(400)
    expect((await request(app).post('/countdowns').send({ title: '纪念日' })).status).toBe(400)
    expect((await request(app).post('/countdowns').send({ title: '纪念日', targetDate: 'bad' })).status).toBe(400)
    expect(service.createCountdown).not.toHaveBeenCalled()

    service.createCountdown.mockResolvedValue({ id: 'c1' })
    const ok = await request(app).post('/countdowns').send({ title: '纪念日', targetDate: '2026-12-31' })
    expect(ok.status).toBe(200)
    expect(service.createCountdown).toHaveBeenCalledWith('user-1', { title: '纪念日', targetDate: '2026-12-31' })
  })

  it('删除倒数日透传错误', async () => {
    service.deleteCountdown.mockResolvedValue(undefined)
    expect((await request(app).delete('/countdowns/c1')).body).toEqual({ success: true })

    service.deleteCountdown.mockRejectedValue(new Error('db down'))
    const fail = await request(app).delete('/countdowns/c1')
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '删除倒数日失败' })
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

describe('提醒路由', () => {
  it('列出提醒，异常返回 500', async () => {
    service.listReminders.mockResolvedValue([])
    expect((await request(app).get('/reminders')).status).toBe(200)

    service.listReminders.mockRejectedValue(new Error('db down'))
    const fail = await request(app).get('/reminders')
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '获取提醒列表失败' })
  })

  it('更新提醒透传 404 与成功结果', async () => {
    service.updateReminder.mockResolvedValue({ id: 'r1', time: '08:00' })
    const ok = await request(app).put('/reminders/r1').send({ time: '08:00' })
    expect(ok.status).toBe(200)
    expect(service.updateReminder).toHaveBeenCalledWith('user-1', 'r1', { time: '08:00' })

    service.updateReminder.mockRejectedValue(httpError('提醒不存在', 404))
    const missing = await request(app).put('/reminders/r1').send({ time: '08:00' })
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: '提醒不存在' })
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
