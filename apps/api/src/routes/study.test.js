import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const service = vi.hoisted(() => ({
  listSessions: vi.fn(),
  recordSession: vi.fn(),
  getSummary: vi.fn(),
  generateSessionComment: vi.fn(),
}))

vi.mock('../services/studyService.js', () => service)
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import studyRoutes from './study.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', studyRoutes)

const httpError = (message, statusCode, code) => Object.assign(new Error(message), { statusCode, code })

beforeEach(() => vi.clearAllMocks())

describe('自习路由', () => {
  it('GET /sessions 默认 30 天，days 参数透传', async () => {
    service.listSessions.mockResolvedValue([])
    const ok = await request(app).get('/sessions')
    expect(ok.status).toBe(200)
    expect(service.listSessions).toHaveBeenCalledWith('user-1', 30)

    await request(app).get('/sessions?days=7')
    expect(service.listSessions).toHaveBeenCalledWith('user-1', 7)
  })

  it('POST /sessions 创建成功，400 透传', async () => {
    service.recordSession.mockResolvedValue({ id: 's1', actualMinutes: 25 })
    const ok = await request(app).post('/sessions').send({ actualMinutes: 25 })
    expect(ok.status).toBe(200)
    expect(service.recordSession).toHaveBeenCalledWith('user-1', { actualMinutes: 25 })

    service.recordSession.mockRejectedValue(httpError('专注时长必须为1到240分钟', 400))
    const bad = await request(app).post('/sessions').send({ actualMinutes: 0 })
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: '专注时长必须为1到240分钟' })
  })

  it('GET /summary 返回统计，未知错误兜底 500', async () => {
    service.getSummary.mockResolvedValue({ todayMinutes: 30, weekMinutes: 50, streak: 2, totalSessions: 3 })
    const ok = await request(app).get('/summary')
    expect(ok.status).toBe(200)
    expect(ok.body.streak).toBe(2)

    service.getSummary.mockRejectedValue(new Error('db down'))
    const fail = await request(app).get('/summary')
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '获取自习统计失败' })
  })

  it('POST /sessions/:id/comment 404 透传与本地模型未配置 code 透传', async () => {
    service.generateSessionComment.mockRejectedValue(httpError('这条记录不存在', 404))
    const missing = await request(app).post('/sessions/none/comment')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: '这条记录不存在' })

    service.generateSessionComment.mockRejectedValue(httpError('本地模型未配置', 503, 'LOCAL_LLM_NOT_CONFIGURED'))
    const fail = await request(app).post('/sessions/s1/comment')
    expect(fail.status).toBe(503)
    expect(fail.body).toEqual({ error: '本地模型未配置', code: 'LOCAL_LLM_NOT_CONFIGURED' })
  })
})
