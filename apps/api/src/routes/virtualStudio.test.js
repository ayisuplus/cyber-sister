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
const PHOTO_BYTES = Buffer.from('fake-png-bytes')

// multipart 表单助手：默认附带合法照片，字段用 overrides 覆盖/删除
function postGeneration(overrides = {}, { withPhoto = true } = {}) {
  const fields = { scene: 'makeup', itemId: 'clear-daily', ...overrides }
  let builder = request(app).post('/image-gen/generations')
  for (const [field, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) builder = builder.field(field, String(value))
  }
  if (withPhoto) {
    builder = builder.attach('photo', PHOTO_BYTES, { filename: 'selfie.png', contentType: 'image/png' })
  }
  return builder
}

beforeEach(() => vi.clearAllMocks())

describe('GET /image-gen/status', () => {
  it('返回生图能力状态形状（含 provider）', async () => {
    service.getImageGenStatus.mockResolvedValue({
      available: true,
      configured: true,
      provider: 'comfy',
      reason: null,
    })
    const response = await request(app).get('/image-gen/status')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      available: true,
      configured: true,
      provider: 'comfy',
      reason: null,
    })
    expect(service.getImageGenStatus).toHaveBeenCalledWith()
  })

  it('service 异常时兜底 500', async () => {
    service.getImageGenStatus.mockRejectedValue(new Error('env broken'))
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
  it('multipart 合法请求 → 201 契约，照片 buffer 透传 service', async () => {
    service.requestGeneration.mockResolvedValue({
      imageDataUrl: 'data:image/png;base64,AAAA',
      scene: 'makeup',
      itemId: 'clear-daily',
      provider: 'comfy',
    })
    const response = await postGeneration({ note: '想要水光感' })
    expect(response.status).toBe(201)
    expect(response.body).toEqual({
      imageDataUrl: 'data:image/png;base64,AAAA',
      scene: 'makeup',
      itemId: 'clear-daily',
      provider: 'comfy',
    })
    expect(service.requestGeneration).toHaveBeenCalledWith({
      scene: 'makeup',
      itemId: 'clear-daily',
      note: '想要水光感',
      photoBuffer: PHOTO_BYTES,
      photoName: 'selfie.png',
      photoMime: 'image/png',
    }, undefined)
  })

  it('缺照片 → 400「请先上传照片」，不进 service', async () => {
    const response = await postGeneration({}, { withPhoto: false })
    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: '请先上传照片' })
    expect(service.requestGeneration).not.toHaveBeenCalled()
  })

  it('照片超过 8MB → 400', async () => {
    const response = await request(app)
      .post('/image-gen/generations')
      .field('scene', 'makeup')
      .field('itemId', 'clear-daily')
      .attach('photo', Buffer.alloc(8 * 1024 * 1024 + 1, 1), { filename: 'huge.png', contentType: 'image/png' })
    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: '照片不能超过 8MB' })
    expect(service.requestGeneration).not.toHaveBeenCalled()
  })

  it('MIME 不符（gif）→ 400', async () => {
    const response = await request(app)
      .post('/image-gen/generations')
      .field('scene', 'makeup')
      .field('itemId', 'clear-daily')
      .attach('photo', PHOTO_BYTES, { filename: 'anim.gif', contentType: 'image/gif' })
    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: '只支持 JPEG、PNG 或 WebP 照片' })
    expect(service.requestGeneration).not.toHaveBeenCalled()
  })

  it('scene 非法值返回 400，不进 service', async () => {
    for (const scene of ['avatar', '', undefined]) {
      const response = await postGeneration({ scene })
      expect(response.status).toBe(400)
      expect(response.body.error).toBe('参数验证失败')
    }
    expect(service.requestGeneration).not.toHaveBeenCalled()
  })

  it('itemId 必填且 ≤64 字符，否则 400', async () => {
    for (const itemId of [undefined, '', 'x'.repeat(65)]) {
      const response = await postGeneration({ itemId })
      expect(response.status).toBe(400)
      expect(response.body.error).toBe('参数验证失败')
    }
    expect(service.requestGeneration).not.toHaveBeenCalled()
  })

  it('note 可选，超过 200 字符返回 400', async () => {
    const tooLong = await postGeneration({ note: 'x'.repeat(201) })
    expect(tooLong.status).toBe(400)
    expect(service.requestGeneration).not.toHaveBeenCalled()
  })

  it('503 IMAGE_GEN_UNAVAILABLE 原样透传（code + 文案）', async () => {
    service.requestGeneration.mockRejectedValue(
      codedError('本地生图服务暂不可用，请稍后重试', 503, 'IMAGE_GEN_UNAVAILABLE'),
    )
    const response = await postGeneration()
    expect(response.status).toBe(503)
    expect(response.body).toEqual({
      error: '本地生图服务暂不可用，请稍后重试',
      code: 'IMAGE_GEN_UNAVAILABLE',
    })
  })

  it('未知错误兜底 500 与固定文案', async () => {
    service.requestGeneration.mockRejectedValue(new Error('unexpected'))
    const response = await postGeneration()
    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: '生图请求失败' })
  })
})
