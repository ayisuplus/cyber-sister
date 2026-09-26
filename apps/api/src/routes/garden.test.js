import express from 'express'
import request from 'supertest'
import { Buffer } from 'node:buffer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({
  listEntries: vi.fn(),
  createEntry: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
  readPhoto: vi.fn(),
}))
const plantId = vi.hoisted(() => ({ identifyPlant: vi.fn() }))
vi.mock('../services/gardenService.js', () => service)
vi.mock('../services/plantIdService.js', () => plantId)
vi.mock('../utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import gardenRoutes from './garden.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', gardenRoutes)

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const bad = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })

beforeEach(() => vi.clearAllMocks())

describe('花草图鉴接口', () => {
  it('列表只取当前用户的，可以按遇见/养着', async () => {
    service.listEntries.mockResolvedValue([{ id: 'a' }])
    const response = await request(app).get('/?status=grow')
    expect(response.body).toEqual({ entries: [{ id: 'a' }] })
    expect(service.listEntries).toHaveBeenCalledWith('user-1', 'grow')
  })

  it('收进图鉴：文字字段、识别结果和两张 JPEG 一起交给服务，身份只认登录的人', async () => {
    service.createEntry.mockResolvedValue({ id: 'new' })
    // 识别结果比普通文字字段长：讲解五段加三个候选，接口要放得下
    const identification = JSON.stringify({ candidates: [{ name: '栀子花' }], explanation: { what: '花'.repeat(1500) } })
    const response = await request(app).post('/')
      .field('name', '栀子花').field('pick', '0').field('identification', identification).field('userId', 'attacker')
      .attach('photo', JPEG, { filename: 'p.jpg', contentType: 'image/jpeg' })
      .attach('thumb', JPEG, { filename: 't.jpg', contentType: 'image/jpeg' })

    expect(response.status).toBe(200)
    const [userId, fields, files] = service.createEntry.mock.calls[0]
    expect(userId).toBe('user-1')
    expect(fields).toMatchObject({ name: '栀子花', pick: '0', identification })
    expect(files.photo[0].buffer.equals(JPEG)).toBe(true)
  })

  it('不是 JPEG、多出来的文件字段在进服务之前拒绝', async () => {
    expect((await request(app).post('/').field('name', '花').attach('photo', PNG, { filename: 'p.png', contentType: 'image/png' })).status).toBe(400)
    expect((await request(app).post('/').attach('avatar', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })).status).toBe(400)
    expect(service.createEntry).not.toHaveBeenCalled()
  })

  it('服务给出的原因原样带回；没预料的错误只给一句通用的话', async () => {
    service.updateEntry.mockRejectedValueOnce(bad('这株花草不存在', 404))
    const missing = await request(app).put('/plant-9').field('note', '阳台')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: '这株花草不存在' })

    service.deleteEntry.mockRejectedValueOnce(new Error('disk exploded at /data/garden/user-1'))
    const broken = await request(app).delete('/plant-9')
    expect(broken.status).toBe(500)
    expect(broken.body).toEqual({ error: '没拿掉，请重试' })
  })

  it('照片与缩略图：不缓存，只作用于自己的', async () => {
    service.readPhoto.mockResolvedValue({ buffer: JPEG, mime: 'image/jpeg' })
    for (const kind of ['photo', 'thumb']) {
      const response = await request(app).get(`/plant-1/${kind}`)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(service.readPhoto).toHaveBeenLastCalledWith('user-1', 'plant-1', kind)
    }
  })
})

describe('认一认接口', () => {
  it('照片交给识别服务，结果原样带回，不落盘', async () => {
    plantId.identifyPlant.mockResolvedValueOnce({ isPlant: true, candidates: [{ name: '栀子花' }] })
    const ok = await request(app).post('/identify').attach('photo', JPEG, { filename: 'p.jpg', contentType: 'image/jpeg' })
    expect(ok.body).toEqual({ isPlant: true, candidates: [{ name: '栀子花' }] })
    const [userId, files] = plantId.identifyPlant.mock.calls[0]
    expect(userId).toBe('user-1')
    expect(files.photo[0].buffer.equals(JPEG)).toBe(true)
    expect(service.createEntry).not.toHaveBeenCalled()
  })

  it('没同意云端、模型不可用时带上 code，页面据此说清原因', async () => {
    plantId.identifyPlant.mockRejectedValueOnce(Object.assign(bad('需要你先同意使用云端模型才能聊天', 503), { code: 'CLOUD_NOT_CONSENTED' }))
    const refused = await request(app).post('/identify').attach('photo', JPEG, { filename: 'p.jpg', contentType: 'image/jpeg' })
    expect(refused.status).toBe(503)
    expect(refused.body).toEqual({ error: '需要你先同意使用云端模型才能聊天', code: 'CLOUD_NOT_CONSENTED' })
  })
})
