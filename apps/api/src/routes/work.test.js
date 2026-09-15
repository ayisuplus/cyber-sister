import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
const configured = vi.hoisted(() => vi.fn(() => false))
vi.mock('../services/llmService.js', () => ({ isCloudProviderConfigured: configured }))

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
    configured.mockReturnValue(false)
    const response = await request(app).get('/status')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ browser: { enabled: false, running: false, headed: false }, execution: { mode: 'agent', cloudConnected: false, persisted: true }, domainGeneration: { mode: 'mock', cloudConnected: false, persisted: false }, recordStorage: 'api' })
    expect(response.body.features.map(feature => feature.id)).toEqual(['schedule', 'diary', 'reading', 'period', 'makeup-room', 'wardrobe', 'workspace', 'letters'])
  })
  it('模型已配置只改变工作对话状态，不把领域模拟或多模态任务标为已接通', async () => {
    configured.mockReturnValue(true)
    const response = await request(app).get('/status')
    expect(response.body.execution.cloudConnected).toBe(true)
    expect(response.body.domainGeneration.cloudConnected).toBe(false)
    expect(response.body.capabilities.mediaGeneration).toBe(false)
    expect(response.body.capabilities.artifacts).toContain('csv')
  })
})
