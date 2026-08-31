import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const service = vi.hoisted(() => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  switchPersona: vi.fn(),
  getExternalLlmConsent: vi.fn(),
  updateExternalLlmConsent: vi.fn(),
  getMembership: vi.fn(),
  subscribeMembership: vi.fn(),
  PERSONAS: ['toxic', 'gentle', 'rational'],
}))

vi.mock('../services/userService.js', () => service)
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import userRoutes from './user.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', userRoutes)

const httpError = (message, statusCode, code) => Object.assign(new Error(message), { statusCode, code })

beforeEach(() => vi.clearAllMocks())

describe('资料路由', () => {
  it('获取资料成功，HttpError 透传状态码，未知错误兜底 500', async () => {
    service.getProfile.mockResolvedValue({ id: 'user-1', nickname: '姐妹' })
    const ok = await request(app).get('/profile')
    expect(ok.status).toBe(200)
    expect(ok.body.nickname).toBe('姐妹')

    service.getProfile.mockRejectedValue(httpError('用户不存在', 404))
    const missing = await request(app).get('/profile')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: '用户不存在' })

    service.getProfile.mockRejectedValue(new Error('db down'))
    const fail = await request(app).get('/profile')
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '获取用户信息失败' })
  })

  it('更新资料成功与失败路径', async () => {
    service.updateProfile.mockResolvedValue({ id: 'user-1', nickname: '新昵称' })
    const ok = await request(app).put('/profile').send({ nickname: '新昵称' })
    expect(ok.status).toBe(200)
    expect(service.updateProfile).toHaveBeenCalledWith('user-1', { nickname: '新昵称' })

    service.updateProfile.mockRejectedValue(httpError('昵称不能超过50个字符', 400))
    const bad = await request(app).put('/profile').send({ nickname: 'x'.repeat(51) })
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: '昵称不能超过50个字符' })
  })
})

describe('人格路由', () => {
  it('非法人格在参数校验层被拦截', async () => {
    const response = await request(app).put('/persona').send({ persona: 'wild' })
    expect(response.status).toBe(400)
    expect(response.body.error).toBe('参数验证失败')
    expect(service.switchPersona).not.toHaveBeenCalled()
  })

  it('合法人格切换成功，service 错误透传', async () => {
    service.switchPersona.mockResolvedValue({ persona: 'gentle' })
    const ok = await request(app).put('/persona').send({ persona: 'gentle' })
    expect(ok.status).toBe(200)
    expect(service.switchPersona).toHaveBeenCalledWith('user-1', 'gentle')

    service.switchPersona.mockRejectedValue(new Error('db down'))
    const fail = await request(app).put('/persona').send({ persona: 'gentle' })
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '切换人格失败' })
  })
})

describe('外部模型同意路由', () => {
  it('查询同意状态', async () => {
    service.getExternalLlmConsent.mockResolvedValue({ accepted: null, version: 'v1', updatedAt: null })
    const ok = await request(app).get('/external-llm-consent')
    expect(ok.status).toBe(200)
    expect(ok.body.accepted).toBeNull()

    service.getExternalLlmConsent.mockRejectedValue(new Error('db down'))
    expect((await request(app).get('/external-llm-consent')).status).toBe(500)
  })

  it('更新同意状态，带 code 的错误原样透传', async () => {
    service.updateExternalLlmConsent.mockResolvedValue({ accepted: true, version: 'v1' })
    const ok = await request(app).put('/external-llm-consent').send({ accepted: true })
    expect(ok.status).toBe(200)
    expect(service.updateExternalLlmConsent).toHaveBeenCalledWith('user-1', true)

    service.updateExternalLlmConsent.mockRejectedValue(httpError('accepted必须是布尔值', 400, 'INVALID_CONSENT'))
    const bad = await request(app).put('/external-llm-consent').send({ accepted: 'yes' })
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: 'accepted必须是布尔值', code: 'INVALID_CONSENT' })
  })
})

describe('会员路由', () => {
  it('查询会员状态', async () => {
    service.getMembership.mockResolvedValue({ isVip: false, vipExpireAt: null })
    const ok = await request(app).get('/membership')
    expect(ok.status).toBe(200)
    expect(ok.body.isVip).toBe(false)

    service.getMembership.mockRejectedValue(new Error('db down'))
    const fail = await request(app).get('/membership')
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '获取会员状态失败' })
  })

  it('订阅返回未开放 409 与稳定 code', async () => {
    service.subscribeMembership.mockImplementation(() => {
      throw httpError('会员功能暂未开放', 409, 'FEATURE_NOT_AVAILABLE')
    })
    const response = await request(app).post('/membership/subscribe')
    expect(response.status).toBe(409)
    expect(response.body).toEqual({ error: '会员功能暂未开放', code: 'FEATURE_NOT_AVAILABLE' })
  })
})
