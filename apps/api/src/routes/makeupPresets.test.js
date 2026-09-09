import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const service = vi.hoisted(() => ({
  listPresets: vi.fn(),
  createPreset: vi.fn(),
  renamePreset: vi.fn(),
  deletePreset: vi.fn(),
}))

vi.mock('../services/makeupPresetService.js', () => service)
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import makeupPresetRoutes from './makeupPresets.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', makeupPresetRoutes)

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode })

beforeEach(() => vi.clearAllMocks())

describe('妆容预设路由', () => {
  it('GET / 返回当前用户预设列表', async () => {
    service.listPresets.mockResolvedValue([{ id: 'p1', name: '日常' }])

    const res = await request(app).get('/')

    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: 'p1', name: '日常' }])
    expect(service.listPresets).toHaveBeenCalledWith('user-1')
  })

  it('POST / 缺名字 → 400，不进 service', async () => {
    const res = await request(app).post('/').send({ smooth: 30, whiten: 20, slim: 10, eye: 10 })

    expect(res.status).toBe(400)
    expect(service.createPreset).not.toHaveBeenCalled()
  })

  it('POST / 创建成功透传 body 并返回结果', async () => {
    const body = { name: '日常', smooth: 30, whiten: 20, slim: 10, eye: 10 }
    service.createPreset.mockResolvedValue({ id: 'p1', ...body })

    const res = await request(app).post('/').send(body)

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('日常')
    expect(service.createPreset).toHaveBeenCalledWith('user-1', body)
  })

  it('POST / 参数越界 → 400 文案', async () => {
    service.createPreset.mockRejectedValue(httpError('妆容参数需为 0-100 的整数', 400))

    const res = await request(app).post('/').send({ name: '日常', smooth: 101, whiten: 20, slim: 10, eye: 10 })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('妆容参数需为 0-100 的整数')
  })

  it('PUT /:id 重命名成功', async () => {
    service.renamePreset.mockResolvedValue({ id: 'p1', name: '新名字' })

    const res = await request(app).put('/p1').send({ name: '新名字' })

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('新名字')
    expect(service.renamePreset).toHaveBeenCalledWith('user-1', 'p1', { name: '新名字' })
  })

  it('PUT /:id 非本人预设 → 404', async () => {
    service.renamePreset.mockRejectedValue(httpError('妆容预设不存在', 404))

    const res = await request(app).put('/p1').send({ name: '新名字' })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('妆容预设不存在')
  })

  it('DELETE /:id 删除成功返回 success', async () => {
    service.deletePreset.mockResolvedValue(undefined)

    const res = await request(app).delete('/p1')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(service.deletePreset).toHaveBeenCalledWith('user-1', 'p1')
  })

  it('service 抛无状态码错误 → 500 兜底文案', async () => {
    service.listPresets.mockRejectedValue(new Error('db down'))

    const res = await request(app).get('/')

    expect(res.status).toBe(500)
    expect(res.body.error).toBe('获取妆容预设失败')
  })
})
