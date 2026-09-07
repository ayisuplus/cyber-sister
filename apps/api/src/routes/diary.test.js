import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const service = vi.hoisted(() => ({
  listMonth: vi.fn(),
  getEntry: vi.fn(),
  upsertEntry: vi.fn(),
  deleteEntry: vi.fn(),
  generateComment: vi.fn(),
}))

vi.mock('../services/diaryService.js', () => service)
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import diaryRoutes from './diary.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  req.requestId = 'req-test'
  next()
})
app.use('/', diaryRoutes)

beforeEach(() => vi.clearAllMocks())

describe('日记路由', () => {
  it('按月份返回日记列表并透传 400', async () => {
    service.listMonth.mockResolvedValue([{ id: 'd1', day: '2026-09-04' }])
    const ok = await request(app).get('/?month=2026-09')
    expect(ok.status).toBe(200)
    expect(ok.body).toHaveLength(1)
    expect(service.listMonth).toHaveBeenCalledWith('user-1', '2026-09')

    service.listMonth.mockRejectedValue(Object.assign(new Error('月份必须是 yyyy-MM 格式'), { statusCode: 400 }))
    const bad = await request(app).get('/?month=2026-9')
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: '月份必须是 yyyy-MM 格式' })
  })

  it('按日期读写删日记并透传 404', async () => {
    service.getEntry.mockResolvedValue({ id: 'd1' })
    expect((await request(app).get('/2026-09-04')).status).toBe(200)

    service.upsertEntry.mockResolvedValue({ id: 'd1', content: '今天' })
    const saved = await request(app).put('/2026-09-04').send({ content: '今天', mood: 'happy' })
    expect(saved.status).toBe(200)
    expect(service.upsertEntry).toHaveBeenCalledWith('user-1', '2026-09-04', { content: '今天', mood: 'happy' })

    service.deleteEntry.mockResolvedValue(undefined)
    expect((await request(app).delete('/2026-09-04')).status).toBe(200)

    service.getEntry.mockRejectedValue(Object.assign(new Error('这一天还没有日记'), { statusCode: 404 }))
    const missing = await request(app).get('/2026-09-05')
    expect(missing.status).toBe(404)
  })

  it('生成日记回应返回结果，模型失败透传 503 与 code', async () => {
    service.generateComment.mockResolvedValue({ aiComment: '我在', source: 'qwen', reused: false })
    const ok = await request(app).post('/2026-09-04/comment')
    expect(ok.status).toBe(200)
    expect(ok.body.aiComment).toBe('我在')
    expect(service.generateComment).toHaveBeenCalledWith('user-1', '2026-09-04', 'req-test')

    service.generateComment.mockRejectedValue(Object.assign(new Error('本地模型暂时不可用，请稍后重试'), { statusCode: 503, code: 'LOCAL_LLM_UNAVAILABLE' }))
    const unavailable = await request(app).post('/2026-09-04/comment')
    expect(unavailable.status).toBe(503)
    expect(unavailable.body).toEqual({ error: '本地模型暂时不可用，请稍后重试', code: 'LOCAL_LLM_UNAVAILABLE' })
  })
})
