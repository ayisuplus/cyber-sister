import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const service = vi.hoisted(() => ({
  getImageGenStatus: vi.fn(),
  requestGeneration: vi.fn(),
}))

vi.mock('../services/imageGenService.js', () => service)
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import virtualStudioRoutes from './virtualStudio.js'
import { authMiddleware } from '../middleware/auth.js'

function buildApp({ authenticated = true } = {}) {
  const app = express()
  app.use(express.json())
  if (authenticated) {
    app.use((req, _res, next) => {
      req.user = { userId: 'user-1' }
      next()
    })
  } else {
    app.use('/api/virtual', authMiddleware)
  }
  app.use(authenticated ? '/' : '/api/virtual', virtualStudioRoutes)
  return app
}

const app = buildApp()
const codedError = (message, statusCode, code) => Object.assign(new Error(message), { statusCode, code })

beforeEach(() => vi.clearAllMocks())

describe('GET /image-gen/status', () => {
  it('返回生图能力状态形状', async () => {
    service.getImageGenStatus.mockReturnValue({
      available: false,
      configured: false,
      reason: 'IMAGE_GEN_NOT_CONFIGURED',
    })
    const response = await request(app).get('/image-gen/status')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      available: false,
      configured: false,
      reason: 'IMAGE_GEN_NOT_CONFIGURED',
    })
    expect(service.getImageGenStatus).toHaveBeenCalledWith()
  })

  it('service 异常时兜底 500', async () => {
    service.getImageGenStatus.mockImplementation(() => {
      throw new Error('env broken')
    })
    const response = await request(app).get('/image-gen/status')
    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: '获取生图能力状态失败' })
  })

  it('未认证返回 401', async () => {
    const unauthed = buildApp({ authenticated: false })
    const response = await request(unauthed).get('/api/virtual/image-gen/status')
    expect(response.status).toBe(401)
    expect(service.getImageGenStatus).not.toHaveBeenCalled()
  })
})

describe('POST /image-gen/generations', () => {
  it('合法请求进入 service 并透传字段；本期恒 503 + code', async () => {
    service.requestGeneration.mockRejectedValue(
      codedError('生图能力接入中，暂未开放', 503, 'IMAGE_GEN_NOT_CONFIGURED'),
    )
    const response = await request(app)
      .post('/image-gen/generations')
      .send({ scene: 'makeup', itemId: 'lip-01', note: '想要水光感' })
    expect(response.status).toBe(503)
    expect(response.body).toEqual({
      error: '生图能力接入中，暂未开放',
      code: 'IMAGE_GEN_NOT_CONFIGURED',
    })
    expect(service.requestGeneration).toHaveBeenCalledWith({
      scene: 'makeup',
      itemId: 'lip-01',
      note: '想要水光感',
    })
  })

  it('scene 非法值返回 400，不进 service', async () => {
    for (const scene of ['avatar', '', undefined]) {
      const body = { itemId: 'lip-01', ...(scene !== undefined ? { scene } : {}) }
      const response = await request(app).post('/image-gen/generations').send(body)
      expect(response.status).toBe(400)
      expect(response.body.error).toBe('参数验证失败')
    }
    expect(service.requestGeneration).not.toHaveBeenCalled()
  })

  it('itemId 必填且 ≤64 字符，否则 400', async () => {
    for (const itemId of [undefined, '', 'x'.repeat(65), 123]) {
      const body = { scene: 'fitting', ...(itemId !== undefined ? { itemId } : {}) }
      const response = await request(app).post('/image-gen/generations').send(body)
      expect(response.status).toBe(400)
      expect(response.body.error).toBe('参数验证失败')
    }
    expect(service.requestGeneration).not.toHaveBeenCalled()
  })

  it('note 可选，超过 200 字符或非字符串返回 400', async () => {
    const tooLong = await request(app)
      .post('/image-gen/generations')
      .send({ scene: 'makeup', itemId: 'lip-01', note: 'x'.repeat(201) })
    expect(tooLong.status).toBe(400)

    const notString = await request(app)
      .post('/image-gen/generations')
      .send({ scene: 'makeup', itemId: 'lip-01', note: 42 })
    expect(notString.status).toBe(400)

    expect(service.requestGeneration).not.toHaveBeenCalled()
  })

  it('未知错误兜底 500 与固定文案', async () => {
    service.requestGeneration.mockRejectedValue(new Error('unexpected'))
    const response = await request(app)
      .post('/image-gen/generations')
      .send({ scene: 'makeup', itemId: 'lip-01' })
    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: '生图请求失败' })
  })
})
