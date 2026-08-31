import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const tracker = vi.hoisted(() => ({
  start: vi.fn(),
  heartbeat: vi.fn(),
  end: vi.fn(),
  getStatus: vi.fn(),
}))

vi.mock('../utils/usageTracker.js', () => ({ default: tracker }))
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import complianceRoutes from './compliance.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', complianceRoutes)

beforeEach(() => vi.clearAllMocks())

describe('使用计时路由', () => {
  it('开始计时返回 success 与状态', async () => {
    tracker.start.mockReturnValue({ minutes: 0, shouldRemind: false, isActive: true })
    const response = await request(app).post('/usage/start')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ success: true, minutes: 0, isActive: true })
    expect(response.body.startAt).toBeDefined()
    expect(tracker.start).toHaveBeenCalledWith('user-1')
  })

  it('开始计时异常返回 500', async () => {
    tracker.start.mockImplementation(() => { throw new Error('boom') })
    const response = await request(app).post('/usage/start')
    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: '开始使用计时失败' })
  })

  it('心跳返回会话状态，无会话时回退为零值', async () => {
    tracker.heartbeat.mockReturnValue({ minutes: 5, shouldRemind: false, isActive: true })
    const active = await request(app).post('/usage/heartbeat')
    expect(active.status).toBe(200)
    expect(active.body.minutes).toBe(5)

    tracker.heartbeat.mockReturnValue(null)
    const inactive = await request(app).post('/usage/heartbeat')
    expect(inactive.body).toEqual({ minutes: 0, shouldRemind: false, isActive: false })
  })

  it('心跳异常返回 500', async () => {
    tracker.heartbeat.mockImplementation(() => { throw new Error('boom') })
    const response = await request(app).post('/usage/heartbeat')
    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: '心跳上报失败' })
  })

  it('结束计时返回 success 与最终状态', async () => {
    tracker.end.mockReturnValue({ minutes: 30, shouldRemind: false })
    const response = await request(app).post('/usage/end')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ success: true, minutes: 30 })
    expect(tracker.end).toHaveBeenCalledWith('user-1')
  })

  it('结束计时异常返回 500', async () => {
    tracker.end.mockImplementation(() => { throw new Error('boom') })
    const response = await request(app).post('/usage/end')
    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: '结束使用计时失败' })
  })

  it('查询状态原样返回，异常返回 500', async () => {
    tracker.getStatus.mockReturnValue({ minutes: 10, shouldRemind: false, isActive: true })
    const ok = await request(app).get('/usage/status')
    expect(ok.status).toBe(200)
    expect(ok.body.minutes).toBe(10)

    tracker.getStatus.mockImplementation(() => { throw new Error('boom') })
    const fail = await request(app).get('/usage/status')
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '获取使用时长失败' })
  })

  it('内测环境不挂载危机上报接口', async () => {
    const response = await request(app).post('/crisis').send({ triggerMsg: 'x', level: 'high' })
    expect(response.status).toBe(404)
  })
})

describe('危机上报路由（非内测环境）', () => {
  it('创建危机记录并在失败时返回 500', async () => {
    vi.resetModules()
    const originalAppEnv = process.env.APP_ENV
    process.env.APP_ENV = 'development'
    try {
      const crisisCreate = vi.fn()
      vi.doMock('../prisma/client.js', () => ({
        default: { crisisLog: { create: crisisCreate } },
      }))
      vi.doMock('../utils/usageTracker.js', () => ({ default: tracker }))
      vi.doMock('../utils/logger.js', () => ({
        default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      }))
      const { default: devRoutes } = await import('./compliance.js')

      const devApp = express()
      devApp.use(express.json())
      devApp.use((req, _res, next) => {
        req.user = { userId: 'user-1' }
        next()
      })
      devApp.use('/', devRoutes)

      crisisCreate.mockResolvedValue({ id: 'log-1' })
      const ok = await request(devApp)
        .post('/crisis')
        .send({ triggerMsg: '撑不下去了', level: 'high' })
      expect(ok.status).toBe(200)
      expect(ok.body).toEqual({ success: true, logId: 'log-1' })
      expect(crisisCreate).toHaveBeenCalledWith({
        data: { userId: 'user-1', triggerMsg: '撑不下去了', level: 'high', handled: false },
      })

      crisisCreate.mockRejectedValue(new Error('db down'))
      const fail = await request(devApp)
        .post('/crisis')
        .send({ triggerMsg: '撑不下去了', level: 'high' })
      expect(fail.status).toBe(500)
      expect(fail.body).toEqual({ error: '危机事件上报失败' })
      // level 只允许 high/medium
      const badLevel = await request(devApp)
        .post('/crisis')
        .send({ triggerMsg: 'x', level: 'critical' })
      expect(badLevel.status).toBe(400)
      expect(badLevel.body).toEqual({ error: '危机等级必须是 high 或 medium' })

      // medium 合法；超长 triggerMsg 截断到 500 字
      crisisCreate.mockResolvedValue({ id: 'log-2' })
      const longMsg = ` ${'长'.repeat(600)} `
      const truncated = await request(devApp)
        .post('/crisis')
        .send({ triggerMsg: longMsg, level: 'medium' })
      expect(truncated.status).toBe(200)
      expect(crisisCreate).toHaveBeenLastCalledWith({
        data: {
          userId: 'user-1',
          triggerMsg: '长'.repeat(500),
          level: 'medium',
          handled: false,
        },
      })

      // 非字符串/空 triggerMsg 不落库原文
      crisisCreate.mockResolvedValue({ id: 'log-3' })
      const emptyMsg = await request(devApp)
        .post('/crisis')
        .send({ triggerMsg: 12345, level: 'high' })
      expect(emptyMsg.status).toBe(200)
      expect(crisisCreate).toHaveBeenLastCalledWith({
        data: { userId: 'user-1', triggerMsg: null, level: 'high', handled: false },
      })
    } finally {
      process.env.APP_ENV = originalAppEnv
      vi.resetModules()
    }
  })
})
