import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const service = vi.hoisted(() => ({
  createMemory: vi.fn(),
  listMemories: vi.fn(),
  updateMemory: vi.fn(),
  deleteMemory: vi.fn(),
  clearAllMemories: vi.fn(),
}))

vi.mock('../services/memoryService.js', () => service)
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import memoriesRoutes from './memories.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', memoriesRoutes)

beforeEach(() => vi.clearAllMocks())

describe('记忆路由', () => {
  it('创建记忆返回 201，错误透传状态码与 code', async () => {
    service.createMemory.mockResolvedValue({ id: 'm1' })
    const ok = await request(app).post('/').send({ type: 'semantic', content: '喜欢火锅' })
    expect(ok.status).toBe(201)
    expect(service.createMemory).toHaveBeenCalledWith('user-1', { type: 'semantic', content: '喜欢火锅' })

    service.createMemory.mockRejectedValue(Object.assign(new Error('记忆内容不能为空'), { statusCode: 400 }))
    const bad = await request(app).post('/').send({ type: 'semantic', content: '' })
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: '记忆内容不能为空' })

    service.createMemory.mockRejectedValue(new Error('db down'))
    const fail = await request(app).post('/').send({ type: 'semantic', content: 'x' })
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '创建记忆失败' })
  })

  it('列表查询透传分页参数，异常兜底 500', async () => {
    service.listMemories.mockResolvedValue({ data: [], total: 0, page: 2, limit: 10 })
    const ok = await request(app).get('/?type=semantic&page=2&limit=10')
    expect(ok.status).toBe(200)
    expect(service.listMemories).toHaveBeenCalledWith('user-1', {
      type: 'semantic',
      page: 2,
      limit: 10,
    })

    service.listMemories.mockRejectedValue(new Error('db down'))
    const fail = await request(app).get('/')
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '获取记忆列表失败' })
  })

  it('编辑记忆成功与失败路径', async () => {
    service.updateMemory.mockResolvedValue({ id: 'm1', importance: 8 })
    const ok = await request(app).put('/m1').send({ importance: 8 })
    expect(ok.status).toBe(200)
    expect(service.updateMemory).toHaveBeenCalledWith('user-1', 'm1', { importance: 8 })

    service.updateMemory.mockRejectedValue(Object.assign(new Error('记忆不存在'), { statusCode: 404 }))
    const missing = await request(app).put('/m1').send({ importance: 8 })
    expect(missing.status).toBe(404)

    service.updateMemory.mockRejectedValue(new Error('db down'))
    const fail = await request(app).put('/m1').send({ importance: 8 })
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '编辑记忆失败' })
  })

  it('删除单条记忆', async () => {
    service.deleteMemory.mockResolvedValue(undefined)
    const ok = await request(app).delete('/m1')
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ success: true })

    service.deleteMemory.mockRejectedValue(new Error('db down'))
    const fail = await request(app).delete('/m1')
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '删除记忆失败' })
  })

  it('清空记忆返回删除数量', async () => {
    service.clearAllMemories.mockResolvedValue(5)
    const ok = await request(app).delete('/')
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ success: true, deleted: 5 })

    service.clearAllMemories.mockRejectedValue(new Error('db down'))
    const fail = await request(app).delete('/')
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '清空记忆失败' })
  })
})
