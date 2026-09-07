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

const suggestionService = vi.hoisted(() => ({
  getMemorySuggestions: vi.fn(),
}))

vi.mock('../services/memoryService.js', () => service)
vi.mock('../services/memorySuggestionService.js', () => suggestionService)
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

describe('记忆建议路由（W3）', () => {
  it('成功返回候选并透传 userId 与 messageId', async () => {
    const candidates = [{ type: 'semantic', content: '用户喜欢吃火锅', importance: 7, tags: ['饮食'] }]
    suggestionService.getMemorySuggestions.mockResolvedValue({ candidates })
    const res = await request(app).post('/suggestions').send({ messageId: 'msg-1' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ candidates })
    expect(suggestionService.getMemorySuggestions).toHaveBeenCalledWith('user-1', 'msg-1', undefined)
  })

  it('归属校验失败（消息不存在）透传 404', async () => {
    suggestionService.getMemorySuggestions.mockRejectedValue(
      Object.assign(new Error('消息不存在'), { statusCode: 404 }),
    )
    const res = await request(app).post('/suggestions').send({ messageId: 'msg-x' })
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: '消息不存在' })
  })

  it('非 user 消息拒绝透传 400', async () => {
    suggestionService.getMemorySuggestions.mockRejectedValue(
      Object.assign(new Error('只能对用户发送的消息生成记忆候选'), { statusCode: 400 }),
    )
    const res = await request(app).post('/suggestions').send({ messageId: 'msg-1' })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: '只能对用户发送的消息生成记忆候选' })
  })

  it('本地模型不可用透传 503 与 LOCAL_LLM_* 错误码', async () => {
    suggestionService.getMemorySuggestions.mockRejectedValue(
      Object.assign(new Error('本地模型暂时不可用，请稍后重试'), {
        statusCode: 503,
        code: 'LOCAL_LLM_UNAVAILABLE',
      }),
    )
    const res = await request(app).post('/suggestions').send({ messageId: 'msg-1' })
    expect(res.status).toBe(503)
    expect(res.body).toEqual({
      error: '本地模型暂时不可用，请稍后重试',
      code: 'LOCAL_LLM_UNAVAILABLE',
    })
  })

  it('未知异常兜底 500', async () => {
    suggestionService.getMemorySuggestions.mockRejectedValue(new Error('db down'))
    const res = await request(app).post('/suggestions').send({ messageId: 'msg-1' })
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: '生成记忆建议失败' })
  })
})
