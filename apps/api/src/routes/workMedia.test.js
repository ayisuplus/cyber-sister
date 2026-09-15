import { describe, expect, it } from 'vitest'
import express from 'express'
import request from 'supertest'
import { authMiddleware, generateToken, generateRefreshToken } from '../middleware/auth.js'
import workMediaRoutes from './workMedia.js'
import { MAX_IMAGE_BYTES } from '../services/workMediaService.js'

const app = express()
app.use(express.json())
app.use('/api/work/media', authMiddleware, workMediaRoutes)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nD8AAAAASUVORK5CYII=', 'base64')
const params = { smooth: 25, whiten: 20, slim: 10, eye: 10 }
const send = (path, userId = 'user-1') => request(app).post(`/api/work/media/${path}/preview`).set('Authorization', `Bearer ${generateToken({ userId })}`)
const attach = req => req.attach('image', PNG, { filename: 'photo.png', contentType: 'image/png' })

describe('work media multipart routes', () => {
  it('requires access authentication before processing uploads', async () => {
    expect((await request(app).post('/api/work/media/makeup/preview')).status).toBe(401)
    expect((await request(app).post('/api/work/media/wardrobe/preview').set('Authorization', `Bearer ${generateRefreshToken({ userId: 'user-1' })}`)).status).toBe(401)
  })
  it('accepts explicit makeup params and returns a non-cacheable mock without an image URL', async () => {
    const res = await attach(send('makeup').field('params', JSON.stringify(params)))
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).toMatchObject({ source: 'cloud_mock', execution: { mode: 'mock', cloudConnected: false, persisted: false }, result: { kind: 'image', imageUrl: null, params } })
  })
  it('keeps separate user requests independent with no persisted item identifiers', async () => {
    const one = await attach(send('wardrobe', 'owner-1').field('name', '我的衣服'))
    const two = await attach(send('wardrobe', 'owner-2'))
    expect(one.status).toBe(200)
    expect(two.body.result.name).toBe('未命名单品')
    expect(one.body.requestId).not.toBe(two.body.requestId)
    expect(one.body.result).toMatchObject({ kind: 'model', modelUrl: null })
    expect(one.body.execution.persisted).toBe(false)
    expect((await request(app).get(`/api/work/media/wardrobe/${one.body.requestId}`).set('Authorization', `Bearer ${generateToken({ userId: 'owner-1' })}`)).status).toBe(404)
  })
  it.each(['{broken', 'null', '[]', JSON.stringify({ ...params, smooth: 0.5 })])('rejects invalid JSON/domain values: %s', async value => {
    expect((await attach(send('makeup').field('params', value))).status).toBe(400)
  })
  it('rejects missing image, remote URL, unexpected ownership fields and too-long names', async () => {
    expect((await send('makeup').field('params', JSON.stringify(params))).status).toBe(400)
    expect((await send('wardrobe').send({ imageUrl: 'http://127.0.0.1/private' })).status).toBe(400)
    expect((await attach(send('wardrobe').field('userId', 'other'))).status).toBe(400)
    expect((await attach(send('wardrobe').field('name', 'x'.repeat(31)))).status).toBe(400)
  })
  it('rejects forged type, multiple images, oversized bodies and wrong upload field', async () => {
    expect((await send('wardrobe').attach('image', Buffer.from('not a PNG'), { filename: 'x.png', contentType: 'image/png' })).status).toBe(400)
    expect((await attach(attach(send('wardrobe')))).status).toBe(400)
    expect((await send('wardrobe').attach('file', PNG, { filename: 'x.png', contentType: 'image/png' })).status).toBe(400)
    const oversized = await send('wardrobe').attach('image', Buffer.alloc(MAX_IMAGE_BYTES + 1), { filename: 'large.png', contentType: 'image/png' })
    expect(oversized.status).toBe(413)
  })
})
