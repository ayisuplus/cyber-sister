import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const svc = vi.hoisted(() => ({
  getPets: vi.fn(),
  claimDailyFood: vi.fn(),
  adopt: vi.fn(),
  setActive: vi.fn(),
  rename: vi.fn(),
  feed: vi.fn(),
  pet: vi.fn(),
}))

vi.mock('../services/petService.js', () => svc)

import petRoutes from './pets.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', petRoutes)
app.use((err, _req, res, _next) => {
  res.status(err.statusCode || 500).json({ error: err.message, ...(err.code ? { code: err.code } : {}) })
})

beforeEach(() => {
  vi.clearAllMocks()
  for (const fn of Object.values(svc)) fn.mockResolvedValue({ ok: true })
})

describe('宠物路由', () => {
  it('读、领饲料、领养、换一只、改名都只作用于当前用户', async () => {
    expect((await request(app).get('/')).status).toBe(200)
    expect(svc.getPets).toHaveBeenCalledWith('user-1')
    await request(app).post('/daily')
    expect(svc.claimDailyFood).toHaveBeenCalledWith('user-1')
    await request(app).post('/').send({ species: 'cat', name: '团子', userId: 'forged' })
    expect(svc.adopt).toHaveBeenCalledWith('user-1', { species: 'cat', name: '团子', userId: 'forged' })
    await request(app).put('/active').send({ species: 'dog' })
    expect(svc.setActive).toHaveBeenCalledWith('user-1', 'dog')
    await request(app).put('/rabbit').send({ name: '棉花' })
    expect(svc.rename).toHaveBeenCalledWith('user-1', 'rabbit', '棉花')
  })

  it('喂与摸：没饲料的 409 原样交给前端', async () => {
    await request(app).post('/cat/pet')
    expect(svc.pet).toHaveBeenCalledWith('user-1', 'cat')
    svc.feed.mockRejectedValue(Object.assign(new Error('饲料吃完啦，明天再来领'), { statusCode: 409, code: 'NO_FOOD' }))
    const response = await request(app).post('/cat/feed')
    expect(response.status).toBe(409)
    expect(response.body).toEqual({ error: '饲料吃完啦，明天再来领', code: 'NO_FOOD' })
  })
})
