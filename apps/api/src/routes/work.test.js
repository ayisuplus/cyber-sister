import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import workRoutes from './work.js'

const app = express()
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', workRoutes)

// 云端切割（2026-09-07）后工作模式不再有内置浏览器/生图/终端：
// /status 恒报浏览器未启用，保留契约形状供前端徽章降级。
describe('work 路由', () => {
  it('GET /status 恒报浏览器未启用', async () => {
    const response = await request(app).get('/status')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ browser: { enabled: false, running: false, headed: false } })
  })
})
