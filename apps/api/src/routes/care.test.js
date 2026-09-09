import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const service = vi.hoisted(() => ({
  listTouchpoints: vi.fn(),
  dismissTouchpoint: vi.fn(),
}))

vi.mock('../services/careService.js', () => service)
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import careRoutes from './care.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', careRoutes)

beforeEach(() => vi.clearAllMocks())

describe('关怀触点路由', () => {
  it('GET /touchpoints 返回触点数组', async () => {
    service.listTouchpoints.mockResolvedValue([{ key: 'k1', kind: 'countdown', title: '「面试」还有 1 天' }])

    const ok = await request(app).get('/touchpoints')

    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ touchpoints: [{ key: 'k1', kind: 'countdown', title: '「面试」还有 1 天' }] })
    expect(service.listTouchpoints).toHaveBeenCalledWith('user-1')
  })

  it('POST /touchpoints/dismiss 透传 key，400 文案透传', async () => {
    service.dismissTouchpoint.mockResolvedValue({ dismissed: true })
    const ok = await request(app).post('/touchpoints/dismiss').send({ key: 'k1' })
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ dismissed: true })
    expect(service.dismissTouchpoint).toHaveBeenCalledWith('user-1', 'k1')

    service.dismissTouchpoint.mockRejectedValue(Object.assign(new Error('触点键不合法'), { statusCode: 400 }))
    const bad = await request(app).post('/touchpoints/dismiss').send({ key: '' })
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: '触点键不合法' })
  })
})
