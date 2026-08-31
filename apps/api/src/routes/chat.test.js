import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const service = vi.hoisted(() => ({
  listConversations: vi.fn(),
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  sendMessage: vi.fn(),
  deleteConversation: vi.fn(),
}))

vi.mock('../services/chatService.js', () => service)
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import chatRoutes from './chat.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', chatRoutes)

describe('chat route 响应合同', () => {
  beforeEach(() => vi.clearAllMocks())

  it('本地模型未配置返回稳定 code 和 503', async () => {
    service.sendMessage.mockRejectedValue(Object.assign(new Error('本地模型尚未配置'), {
      code: 'LOCAL_LLM_NOT_CONFIGURED',
      statusCode: 503,
    }))

    const response = await request(app)
      .post('/conversations/conversation-1/messages')
      .send({ content: '你好' })

    expect(response.status).toBe(503)
    expect(response.body).toEqual({
      error: '本地模型尚未配置',
      code: 'LOCAL_LLM_NOT_CONFIGURED',
    })
  })

  it('模型不可用返回稳定 code 和 503', async () => {
    service.sendMessage.mockRejectedValue(Object.assign(new Error('外部模型暂时不可用，请稍后重试'), {
      code: 'LLM_UNAVAILABLE',
      statusCode: 503,
    }))

    const response = await request(app)
      .post('/conversations/conversation-1/messages')
      .send({ content: '保留输入以便重试' })

    expect(response.status).toBe(503)
    expect(response.body.code).toBe('LLM_UNAVAILABLE')
  })

  it('blocked 联合类型原样返回', async () => {
    const blocked = {
      status: 'blocked',
      userMessage: { id: 'message-1', role: 'user', content: '风险输入' },
      intervention: { level: 'high', message: '固定干预', resources: [] },
    }
    service.sendMessage.mockResolvedValue(blocked)

    const response = await request(app)
      .post('/conversations/conversation-1/messages')
      .send({ content: '风险输入' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual(blocked)
  })

  it('拒绝只含空白字符的消息', async () => {
    const response = await request(app)
      .post('/conversations/conversation-1/messages')
      .send({ content: '   ' })

    expect(response.status).toBe(400)
    expect(service.sendMessage).not.toHaveBeenCalled()
  })
  it('超长消息被参数校验拦截', async () => {
    const response = await request(app)
      .post('/conversations/conversation-1/messages')
      .send({ content: 'x'.repeat(10001) })

    expect(response.status).toBe(400)
    expect(service.sendMessage).not.toHaveBeenCalled()
  })

  it('未知异常返回 500 且不泄露内部错误消息', async () => {
    service.sendMessage.mockRejectedValue(new Error('db connection reset'))

    const response = await request(app)
      .post('/conversations/conversation-1/messages')
      .send({ content: '你好' })

    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: '发送消息失败' })
  })

  it('会话列表成功返回，失败按状态码透传或兜底 500', async () => {
    service.listConversations.mockResolvedValue([{ id: 'c1' }])
    const ok = await request(app).get('/conversations')
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual([{ id: 'c1' }])
    expect(service.listConversations).toHaveBeenCalledWith('user-1', { page: NaN, limit: NaN })

    service.listConversations.mockRejectedValue(Object.assign(new Error('无权限'), { statusCode: 403 }))
    const forbidden = await request(app).get('/conversations')
    expect(forbidden.status).toBe(403)
    expect(forbidden.body).toEqual({ error: '无权限' })

    service.listConversations.mockRejectedValue(new Error('db down'))
    const fail = await request(app).get('/conversations')
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '获取会话列表失败' })
  })
  it('分页查询参数透传到 service', async () => {
    service.listConversations.mockResolvedValue([])
    await request(app).get('/conversations?page=2&limit=10')
    expect(service.listConversations).toHaveBeenCalledWith('user-1', { page: 2, limit: 10 })

    service.getConversation.mockResolvedValue({ id: 'c1', messages: [] })
    await request(app).get('/conversations/c1?page=3&limit=25')
    expect(service.getConversation).toHaveBeenCalledWith('c1', 'user-1', { page: 3, limit: 25 })
  })

  it('新建会话成功与失败路径', async () => {
    service.createConversation.mockResolvedValue({ id: 'c1', title: '赛博姐妹' })
    const ok = await request(app).post('/conversations').send({ title: '倾诉' })
    expect(ok.status).toBe(200)
    expect(service.createConversation).toHaveBeenCalledWith('user-1', { title: '倾诉' })

    service.createConversation.mockRejectedValue(new Error('db down'))
    const fail = await request(app).post('/conversations').send({})
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '新建会话失败' })
  })

  it('会话详情 404 透传，未知错误兜底', async () => {
    service.getConversation.mockResolvedValue({ id: 'c1', messages: [] })
    const ok = await request(app).get('/conversations/c1')
    expect(ok.status).toBe(200)
    expect(service.getConversation).toHaveBeenCalledWith('c1', 'user-1', { page: NaN, limit: NaN })

    service.getConversation.mockRejectedValue(Object.assign(new Error('会话不存在'), { statusCode: 404 }))
    const missing = await request(app).get('/conversations/c1')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: '会话不存在' })

    service.getConversation.mockRejectedValue(new Error('db down'))
    const fail = await request(app).get('/conversations/c1')
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '获取会话详情失败' })
  })

  it('删除会话成功返回 success，失败透传状态码', async () => {
    service.deleteConversation.mockResolvedValue(undefined)
    const ok = await request(app).delete('/conversations/c1')
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ success: true })
    expect(service.deleteConversation).toHaveBeenCalledWith('c1', 'user-1')

    service.deleteConversation.mockRejectedValue(Object.assign(new Error('会话不存在'), { statusCode: 404 }))
    const missing = await request(app).delete('/conversations/c1')
    expect(missing.status).toBe(404)

    service.deleteConversation.mockRejectedValue(new Error('db down'))
    const fail = await request(app).delete('/conversations/c1')
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '删除会话失败' })
  })
})
