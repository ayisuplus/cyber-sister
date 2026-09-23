import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const service = vi.hoisted(() => ({
  createPairing: vi.fn(),
  claimPairing: vi.fn(),
  listBridges: vi.fn(),
  revokeBridge: vi.fn(),
  authenticateBridge: vi.fn(),
  touchBridge: vi.fn(() => Promise.resolve()),
}))

vi.mock('../services/bridgeService.js', () => service)
vi.mock('../middleware/auth.js', () => ({
  authMiddleware: (req, res, next) => {
    if (req.headers.authorization !== 'Bearer user-token') return res.status(401).json({ error: '未登录' })
    req.user = { userId: 'user-1' }
    return next()
  },
}))
vi.mock('../utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import bridgeRoutes from './bridge.js'
import { dispatchJob, resetBridgeBroker } from '../services/bridgeBroker.js'

const app = express()
app.use(express.json())
app.use('/', bridgeRoutes)

const asUser = (call) => call.set('Authorization', 'Bearer user-token')
const asBridge = (call) => call.set('Authorization', 'Bridge bridge-token-for-tests-0123456789abcdef')

beforeEach(() => {
  vi.clearAllMocks()
  service.authenticateBridge.mockImplementation((token) => Promise.resolve(token === 'bridge-token-for-tests-0123456789abcdef' ? { id: 'b1', userId: 'user-1', lastSeenAt: null } : null))
})
afterEach(() => resetBridgeBroker())

describe('本机助手路由', () => {
  it('设置页的连接码、列表与断开都需要登录，并只作用于当前用户', async () => {
    expect((await request(app).post('/pairings')).status).toBe(401)
    service.createPairing.mockResolvedValue({ code: 'ABCD2345', expiresAt: '2026-09-19T10:10:00.000Z' })
    expect((await asUser(request(app).post('/pairings'))).body).toEqual({ code: 'ABCD2345', expiresAt: '2026-09-19T10:10:00.000Z' })
    expect(service.createPairing).toHaveBeenCalledWith('user-1')

    service.listBridges.mockResolvedValue([{ id: 'b1', online: true }])
    expect((await asUser(request(app).get('/'))).body).toEqual({ bridges: [{ id: 'b1', online: true }] })

    service.revokeBridge.mockRejectedValue(Object.assign(new Error('这台电脑不存在或已断开'), { statusCode: 404 }))
    expect((await asUser(request(app).delete('/b9'))).status).toBe(404)
    expect(service.revokeBridge).toHaveBeenCalledWith('user-1', 'b9')
  })

  it('助手用连接码换令牌，不需要登录', async () => {
    service.claimPairing.mockResolvedValue({ token: 't', bridgeId: 'b1', name: '书房电脑' })
    const claimed = await request(app).post('/claim').send({ code: 'ABCD2345', name: '书房电脑' })
    expect(claimed.body).toEqual({ token: 't', bridgeId: 'b1', name: '书房电脑' })
    service.claimPairing.mockRejectedValue(Object.assign(new Error('连接码无效或已过期'), { statusCode: 400 }))
    expect((await request(app).post('/claim').send({ code: 'nope' })).status).toBe(400)
  })

  it('没有或失效的令牌取不了任务，也交不了结果', async () => {
    expect((await request(app).get('/poll')).body.code).toBe('BRIDGE_UNAUTHORIZED')
    expect((await request(app).get('/poll').set('Authorization', 'Bridge revoked-token-000000000000000000000000')).status).toBe(401)
    expect((await request(app).post('/jobs/j1/result').send({ ok: true })).status).toBe(401)
  })

  it('取到任务、交回结果，调用方拿到结果；不认识的任务 404', async () => {
    const polled = asBridge(request(app).get('/poll'))
    const pollResponse = polled.then((response) => response)
    // 等助手挂上轮询后再派任务
    await vi.waitFor(() => expect(service.touchBridge).toHaveBeenCalled())
    const pending = dispatchJob('user-1', 'list', { path: '' })
    const { body } = await pollResponse
    expect(body.job).toMatchObject({ tool: 'list', args: { path: '' } })

    expect((await asBridge(request(app).post(`/jobs/${body.job.id}/result`)).send({ ok: true, result: { entries: [{ name: 'a.md' }] } })).body).toEqual({ ok: true })
    await expect(pending).resolves.toEqual({ entries: [{ name: 'a.md' }] })
    expect((await asBridge(request(app).post(`/jobs/${body.job.id}/result`)).send({ ok: true })).status).toBe(404)
  })
})
