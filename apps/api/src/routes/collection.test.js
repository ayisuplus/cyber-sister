import express from 'express'
import request from 'supertest'
import { Buffer } from 'node:buffer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({
  MAX_PHOTO_BYTES: 64 * 1024,
  listItems: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  readPhoto: vi.fn(),
}))
vi.mock('../services/collectionService.js', () => service)
vi.mock('../utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import collectionRoutes from './collection.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', collectionRoutes)

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const bad = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })

beforeEach(() => vi.clearAllMocks())

describe('收藏接口', () => {
  it('列表只取当前用户的，按柜子', async () => {
    service.listItems.mockResolvedValue([{ id: 'a' }])
    const response = await request(app).get('/?shelf=makeup')
    expect(response.body).toEqual({ items: [{ id: 'a' }] })
    expect(service.listItems).toHaveBeenCalledWith('user-1', 'makeup')
  })

  it('放进来：文字字段和两张 JPEG 一起交给服务，身份只认登录的人', async () => {
    service.createItem.mockResolvedValue({ id: 'new' })
    const response = await request(app).post('/')
      .field('shelf', 'wardrobe').field('name', '白衬衫').field('userId', 'attacker')
      .attach('photo', JPEG, { filename: 'p.jpg', contentType: 'image/jpeg' })
      .attach('thumb', JPEG, { filename: 't.jpg', contentType: 'image/jpeg' })

    expect(response.status).toBe(200)
    const [userId, fields, files] = service.createItem.mock.calls[0]
    expect(userId).toBe('user-1')
    expect(fields).toMatchObject({ shelf: 'wardrobe', name: '白衬衫' })
    expect(files.photo[0].buffer.equals(JPEG)).toBe(true)
    expect(files.thumb[0].buffer.equals(JPEG)).toBe(true)
  })

  it('不是 JPEG、太大、多出来的文件字段都在进服务之前拒绝', async () => {
    const png = await request(app).post('/').field('shelf', 'wardrobe').attach('photo', PNG, { filename: 'p.png', contentType: 'image/png' })
    expect(png.status).toBe(400)
    const huge = await request(app).post('/').field('shelf', 'wardrobe').attach('photo', Buffer.alloc(70 * 1024), { filename: 'p.jpg', contentType: 'image/jpeg' })
    expect(huge.status).toBe(400)
    expect(huge.body.error).toBe('这张照片太大了，请换一张')
    const extra = await request(app).post('/').attach('avatar', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
    expect(extra.status).toBe(400)
    expect(service.createItem).not.toHaveBeenCalled()
  })

  it('服务给出的原因原样带回；没预料的错误只给一句通用的话', async () => {
    service.updateItem.mockRejectedValueOnce(bad('这件收藏不存在', 404))
    const missing = await request(app).put('/item-9').field('name', '改名')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: '这件收藏不存在' })
    expect(service.updateItem.mock.calls[0].slice(0, 2)).toEqual(['user-1', 'item-9'])

    service.deleteItem.mockRejectedValueOnce(new Error('disk exploded at /data/collection/user-1'))
    const broken = await request(app).delete('/item-9')
    expect(broken.status).toBe(500)
    expect(broken.body).toEqual({ error: '没删掉，请重试' })
  })

  it('照片与缩略图：不缓存，只作用于自己的', async () => {
    service.readPhoto.mockResolvedValue({ buffer: JPEG, mime: 'image/jpeg' })
    for (const kind of ['photo', 'thumb']) {
      const response = await request(app).get(`/item-1/${kind}`)
      expect(response.status).toBe(200)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.headers['content-type']).toContain('image/jpeg')
      expect(service.readPhoto).toHaveBeenLastCalledWith('user-1', 'item-1', kind)
    }
    service.deleteItem.mockResolvedValue()
    expect((await request(app).delete('/item-1')).body).toEqual({ success: true })
  })
})
