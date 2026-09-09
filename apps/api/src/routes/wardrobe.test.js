import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const service = vi.hoisted(() => ({
  listItems: vi.fn(),
  createItem: vi.fn(),
  readItemFile: vi.fn(),
  deleteItem: vi.fn(),
}))

vi.mock('../services/wardrobeService.js', () => service)
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import wardrobeRoutes from './wardrobe.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', wardrobeRoutes)

const httpError = (message, statusCode, code) => Object.assign(new Error(message), { statusCode, code })
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47])

beforeEach(() => vi.clearAllMocks())

describe('衣柜路由', () => {
  it('GET / 返回列表', async () => {
    service.listItems.mockResolvedValue([{ id: 'i1', name: '风衣' }])

    const res = await request(app).get('/')

    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: 'i1', name: '风衣' }])
    expect(service.listItems).toHaveBeenCalledWith('user-1')
  })

  it('POST / 未带图片 → 400「请选择图片」', async () => {
    const res = await request(app).post('/').field('name', '风衣')

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('请选择图片')
    expect(service.createItem).not.toHaveBeenCalled()
  })

  it('POST / 3D 服务未配置 → 503 且透传 code', async () => {
    service.createItem.mockRejectedValue(httpError('3D 生成服务还没接好，开放后第一时间告诉你', 503, 'IMAGE_TO_3D_NOT_CONFIGURED'))

    const res = await request(app).post('/').attach('image', PNG, { filename: 'coat.png', contentType: 'image/png' })

    expect(res.status).toBe(503)
    expect(res.body.code).toBe('IMAGE_TO_3D_NOT_CONFIGURED')
    expect(res.body.error).toBe('3D 生成服务还没接好，开放后第一时间告诉你')
  })

  it('POST / 创建成功：文件与名字透传 service', async () => {
    service.createItem.mockResolvedValue({ id: 'i1', name: '黑色风衣' })

    const res = await request(app)
      .post('/')
      .field('name', '黑色风衣')
      .attach('image', PNG, { filename: 'coat.png', contentType: 'image/png' })

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('i1')
    expect(service.createItem).toHaveBeenCalledWith('user-1', expect.objectContaining({
      name: '黑色风衣',
      mime: 'image/png',
    }))
    expect(service.createItem.mock.calls[0][1].buffer.equals(PNG)).toBe(true)
  })

  it('POST / 非图片类型 → 400 类型文案', async () => {
    const res = await request(app).post('/').attach('image', Buffer.from('gif89a'), { filename: 'x.gif', contentType: 'image/gif' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('仅支持 JPEG/PNG/WebP 图片')
    expect(service.createItem).not.toHaveBeenCalled()
  })

  it('GET /:id/source 与 /:id/model 回传二进制与 Content-Type，禁缓存', async () => {
    service.readItemFile
      .mockResolvedValueOnce({ buffer: PNG, mime: 'image/png' })
      .mockResolvedValueOnce({ buffer: Buffer.from('glTF'), mime: 'model/gltf-binary' })

    const source = await request(app).get('/i1/source')
    expect(source.status).toBe(200)
    expect(source.headers['content-type']).toContain('image/png')
    expect(source.headers['cache-control']).toBe('no-store')
    expect(service.readItemFile).toHaveBeenNthCalledWith(1, 'user-1', 'i1', 'source')

    const model = await request(app).get('/i1/model')
    expect(model.status).toBe(200)
    expect(model.headers['content-type']).toContain('model/gltf-binary')
    expect(service.readItemFile).toHaveBeenNthCalledWith(2, 'user-1', 'i1', 'model')
  })

  it('GET /:id/source 非本人 → 404', async () => {
    service.readItemFile.mockRejectedValue(httpError('单品不存在', 404))

    const res = await request(app).get('/i9/source')

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('单品不存在')
  })

  it('DELETE /:id 成功返回 success；非本人 → 404', async () => {
    service.deleteItem.mockResolvedValue(undefined)

    const res = await request(app).delete('/i1')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(service.deleteItem).toHaveBeenCalledWith('user-1', 'i1')

    service.deleteItem.mockRejectedValue(httpError('单品不存在', 404))
    const missing = await request(app).delete('/i9')
    expect(missing.status).toBe(404)
  })
})
