import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const service = vi.hoisted(() => ({
  listLetters: vi.fn(),
  generateWeeklyLetter: vi.fn(),
  getLetter: vi.fn(),
}))

vi.mock('../services/letterService.js', () => service)
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import letterRoutes from './letters.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', letterRoutes)

beforeEach(() => vi.clearAllMocks())

describe('她的信路由', () => {
  it('GET / 返回来信列表', async () => {
    service.listLetters.mockResolvedValue([{ id: 'l1', content: '信' }])

    const ok = await request(app).get('/')

    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ letters: [{ id: 'l1', content: '信' }] })
    expect(service.listLetters).toHaveBeenCalledWith('user-1')
  })

  it('POST /generate 幂等透传（含沉默周 quiet）', async () => {
    service.generateWeeklyLetter.mockResolvedValue({ letter: { id: 'l1' }, created: true })
    const created = await request(app).post('/generate')
    expect(created.status).toBe(200)
    expect(created.body).toEqual({ letter: { id: 'l1' }, created: true })
    expect(service.generateWeeklyLetter).toHaveBeenCalledWith('user-1')

    service.generateWeeklyLetter.mockResolvedValue({ letter: null, created: false, reason: 'quiet' })
    const quiet = await request(app).post('/generate')
    expect(quiet.status).toBe(200)
    expect(quiet.body).toEqual({ letter: null, created: false, reason: 'quiet' })
  })

  it('GET /:id 返回单封，404 透传', async () => {
    service.getLetter.mockResolvedValue({ id: 'l1', content: '信' })
    const ok = await request(app).get('/l1')
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ letter: { id: 'l1', content: '信' } })
    expect(service.getLetter).toHaveBeenCalledWith('user-1', 'l1')

    service.getLetter.mockRejectedValue(Object.assign(new Error('信件不存在'), { statusCode: 404 }))
    const missing = await request(app).get('/nope')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: '信件不存在' })
  })
})
