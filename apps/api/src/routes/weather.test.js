import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const svc = vi.hoisted(() => ({
  getUserWeather: vi.fn(),
  searchPlaces: vi.fn(),
  setPlace: vi.fn(),
  clearPlace: vi.fn(),
}))

vi.mock('../services/weatherService.js', () => svc)

import weatherRoutes from './weather.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', weatherRoutes)
app.use((err, _req, res, _next) => {
  res.status(err.statusCode || 500).json({ error: err.message, ...(err.code ? { code: err.code } : {}) })
})

beforeEach(() => vi.clearAllMocks())

describe('天气路由', () => {
  it('GET / 按当前用户取天气', async () => {
    svc.getUserWeather.mockResolvedValue({ place: null })
    const response = await request(app).get('/')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ place: null })
    expect(svc.getUserWeather).toHaveBeenCalledWith('user-1')
  })

  it('取不到时把 503 与错误码原样交给前端', async () => {
    const error = Object.assign(new Error('天气暂时取不到，请稍后再看'), { statusCode: 503, code: 'WEATHER_UNAVAILABLE' })
    svc.getUserWeather.mockRejectedValue(error)
    const response = await request(app).get('/')
    expect(response.status).toBe(503)
    expect(response.body.code).toBe('WEATHER_UNAVAILABLE')
  })

  it('GET /places 把查询词交给服务', async () => {
    svc.searchPlaces.mockResolvedValue({ places: [] })
    const response = await request(app).get('/places').query({ q: '杭州' })
    expect(response.status).toBe(200)
    expect(svc.searchPlaces).toHaveBeenCalledWith('杭州')
  })

  it('PUT /place 与 DELETE /place 只作用于当前用户', async () => {
    svc.setPlace.mockResolvedValue({ place: { name: '杭州' } })
    svc.clearPlace.mockResolvedValue({ place: null })
    const body = { name: '杭州', latitude: 30.29, longitude: 120.16 }
    expect((await request(app).put('/place').send(body)).status).toBe(200)
    expect(svc.setPlace).toHaveBeenCalledWith('user-1', body)
    expect((await request(app).delete('/place')).status).toBe(200)
    expect(svc.clearPlace).toHaveBeenCalledWith('user-1')
  })
})
