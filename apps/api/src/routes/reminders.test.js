import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const service = vi.hoisted(() => ({
  listScheduledReminders: vi.fn(),
  createScheduledReminder: vi.fn(),
  updateScheduledReminder: vi.fn(),
  deleteScheduledReminder: vi.fn(),
  listDueReminders: vi.fn(),
  ackDelivery: vi.fn(),
}))

vi.mock('../services/reminderService.js', () => service)
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import reminderRoutes from './reminders.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', reminderRoutes)

beforeEach(() => vi.clearAllMocks())

describe('自定义提醒路由', () => {
  it('GET /scheduled 返回提醒列表', async () => {
    service.listScheduledReminders.mockResolvedValue([{ id: 'r1', content: '取快递', freq: 'once' }])
    const res = await request(app).get('/scheduled')
    expect(res.status).toBe(200)
    expect(res.body.reminders).toHaveLength(1)
    expect(service.listScheduledReminders).toHaveBeenCalledWith('user-1')
  })

  it('POST /scheduled 创建成功返回 201；校验失败透传 400', async () => {
    service.createScheduledReminder.mockResolvedValue({ id: 'r1', nextFireAt: '2026-09-12T10:00:00.000Z' })
    const ok = await request(app).post('/scheduled').send({ content: '取快递', freq: 'once', date: '2026-09-12', time: '18:00' })
    expect(ok.status).toBe(201)

    service.createScheduledReminder.mockRejectedValue(Object.assign(new Error('提醒时间必须是 HH:mm 格式'), { statusCode: 400 }))
    const bad = await request(app).post('/scheduled').send({ content: 'x', freq: 'daily', time: '25:00' })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toContain('HH:mm')
  })

  it('PUT /scheduled/:id 与 DELETE /scheduled/:id', async () => {
    service.updateScheduledReminder.mockResolvedValue({ id: 'r1', status: 'paused' })
    const upd = await request(app).put('/scheduled/r1').send({ status: 'paused' })
    expect(upd.status).toBe(200)
    expect(service.updateScheduledReminder).toHaveBeenCalledWith('r1', 'user-1', { status: 'paused' })

    service.deleteScheduledReminder.mockResolvedValue({})
    const del = await request(app).delete('/scheduled/r1')
    expect(del.status).toBe(200)
    expect(del.body.ok).toBe(true)
  })

  it('GET /due 返回 pending 投递；POST /deliveries/:id/ack 确认', async () => {
    service.listDueReminders.mockResolvedValue([{ id: 'd1', reminder: { content: '喝水' } }])
    const due = await request(app).get('/due')
    expect(due.status).toBe(200)
    expect(due.body.deliveries[0].reminder.content).toBe('喝水')

    service.ackDelivery.mockResolvedValue({ id: 'd1', status: 'shown' })
    const ack = await request(app).post('/deliveries/d1/ack').send({ action: 'shown' })
    expect(ack.status).toBe(200)
    expect(service.ackDelivery).toHaveBeenCalledWith('d1', 'user-1', 'shown')
  })

  it('service 抛 404 时路由透传 404', async () => {
    service.ackDelivery.mockRejectedValue(Object.assign(new Error('提醒投递不存在'), { statusCode: 404 }))
    const res = await request(app).post('/deliveries/nope/ack').send({ action: 'shown' })
    expect(res.status).toBe(404)
  })
})
