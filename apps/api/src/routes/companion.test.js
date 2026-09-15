import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const service = vi.hoisted(() => ({ getCompanionState: vi.fn(), recoverCompanionState: vi.fn() }))
vi.mock('../services/companionService.js', () => service)
import router from './user.js'
const app = express()
app.use(express.json())
app.use((req, _res, next) => { req.user = { userId: 'authenticated-owner' }; next() })
app.use('/user', router)
beforeEach(() => vi.clearAllMocks())

describe('角色状态 API', () => {
  it('读取只使用认证归属，禁止缓存', async () => {
    service.getCompanionState.mockResolvedValue({ revision: 0, state: { experienceCount: 0 } })
    const response = await request(app).get('/user/companion?userId=other')
    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(service.getCompanionState).toHaveBeenCalledWith('authenticated-owner')
  })
  it('恢复只接受当前版本，不传递客户端伪造的状态、身份或信任', async () => {
    service.recoverCompanionState.mockResolvedValue({ revision: 4 })
    const response = await request(app).post('/user/companion/recover').send({ expectedRevision: 3, userId: 'other', state: { trust: 1 } })
    expect(response.status).toBe(200)
    expect(service.recoverCompanionState).toHaveBeenCalledWith('authenticated-owner', 3)
  })
  it('并发冲突返回可识别的 409，内部错误不泄露内容', async () => {
    service.recoverCompanionState.mockRejectedValue({ statusCode: 409, code: 'COMPANION_CONFLICT', message: '角色状态已变化' })
    const response = await request(app).post('/user/companion/recover').send({ expectedRevision: 3 })
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('COMPANION_CONFLICT')
    service.getCompanionState.mockRejectedValue(new Error('private database detail'))
    const failed = await request(app).get('/user/companion')
    expect(failed.status).toBe(500)
    expect(failed.body).toEqual({ error: '读取角色状态失败' })
  })
})
