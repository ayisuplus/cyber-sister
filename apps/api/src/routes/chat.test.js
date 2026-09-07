import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import http from 'node:http'
import request from 'supertest'

const service = vi.hoisted(() => ({
  listConversations: vi.fn(),
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  sendMessage: vi.fn(),
  sendMessageStream: vi.fn(),
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

function streamOf(events) {
  return (async function* () {
    for (const event of events) yield event
  })()
}

/** 首事件即抛错的流（等价于 async generator 体首行 throw）。 */
function failingStream(error) {
  return {
    [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(error) }),
  }
}

function parseSseFrames(text) {
  return text.split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice('data: '.length)))
}

const savedTurn = {
  status: 'ok',
  userMessage: { id: 'user-message', role: 'user', content: '你好' },
  aiMessage: { id: 'ai-message', role: 'assistant', content: '第一句。第二句！', source: 'local_model' },
  source: 'local_model',
}

describe('chat stream route SSE 合同', () => {
  beforeEach(() => vi.clearAllMocks())

  it('SSE 响应头齐全，事件按 delta→done 编码为 data 帧', async () => {
    service.sendMessageStream.mockReturnValue(streamOf([
      { type: 'sentence', text: '第一句。' },
      { type: 'sentence', text: '第二句！' },
      { type: 'done', ...savedTurn },
    ]))

    const response = await request(app)
      .post('/conversations/conversation-1/messages/stream')
      .send({ content: '你好' })

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/event-stream')
    expect(response.headers['cache-control']).toBe('no-cache')
    expect(response.headers['x-accel-buffering']).toBe('no')
    expect(parseSseFrames(response.text)).toEqual([
      { event: 'delta', text: '第一句。' },
      { event: 'delta', text: '第二句！' },
      { event: 'done', ...savedTurn },
    ])
    expect(service.sendMessageStream).toHaveBeenCalledOnce()
    const [id, userId, content, requestId, options] = service.sendMessageStream.mock.calls[0]
    expect([id, userId, content, requestId]).toEqual(['conversation-1', 'user-1', '你好', undefined])
    expect(typeof options.signal.aborted).toBe('boolean')
  })

  it('过滤命中时 replace 事件先于 done，且只携带模板全文', async () => {
    service.sendMessageStream.mockReturnValue(streamOf([
      { type: 'replace', content: '本地安全模板全文', source: 'local_template' },
      { type: 'done', ...savedTurn },
    ]))

    const response = await request(app)
      .post('/conversations/conversation-1/messages/stream')
      .send({ content: '你好' })

    const frames = parseSseFrames(response.text)
    expect(frames[0]).toEqual({ event: 'replace', content: '本地安全模板全文' })
    expect(frames[1]).toEqual({ event: 'done', ...savedTurn })
  })

  it('危机输入编码为 blocked 事件，结构与 JSON 端点一致', async () => {
    const blocked = {
      type: 'blocked',
      status: 'blocked',
      userMessage: { id: 'user-message', role: 'user', content: '风险输入' },
      intervention: { level: 'high', message: '固定干预', resources: [] },
    }
    service.sendMessageStream.mockReturnValue(streamOf([blocked]))

    const response = await request(app)
      .post('/conversations/conversation-1/messages/stream')
      .send({ content: '风险输入' })

    expect(response.status).toBe(200)
    expect(parseSseFrames(response.text)).toEqual([{
      event: 'blocked',
      status: 'blocked',
      userMessage: blocked.userMessage,
      intervention: blocked.intervention,
    }])
  })

  it('模型失败编码为固定 code 的 error 事件，不含对话内容', async () => {
    service.sendMessageStream.mockReturnValue(streamOf([
      { type: 'error', reason: 'LLM_UNAVAILABLE' },
    ]))

    const response = await request(app)
      .post('/conversations/conversation-1/messages/stream')
      .send({ content: '保留输入以便重试' })

    expect(parseSseFrames(response.text)).toEqual([{ event: 'error', code: 'LLM_UNAVAILABLE' }])
    expect(response.text).not.toContain('保留输入以便重试')
  })

  it('service 抛出的业务错误与未知异常分别映射既有 code 与 STREAM_FAILED', async () => {
    service.sendMessageStream.mockReturnValue(failingStream(
      Object.assign(new Error('本地模型尚未配置'), {
        code: 'LOCAL_LLM_NOT_CONFIGURED',
        statusCode: 503,
      }),
    ))

    const configured = await request(app)
      .post('/conversations/conversation-1/messages/stream')
      .send({ content: '你好' })
    expect(parseSseFrames(configured.text)).toEqual([
      { event: 'error', code: 'LOCAL_LLM_NOT_CONFIGURED' },
    ])

    service.sendMessageStream.mockReturnValue(failingStream(new Error('db connection reset')))

    const unknown = await request(app)
      .post('/conversations/conversation-1/messages/stream')
      .send({ content: '你好' })
    expect(parseSseFrames(unknown.text)).toEqual([{ event: 'error', code: 'STREAM_FAILED' }])
    expect(unknown.text).not.toContain('db connection reset')
  })

  it('每 15 秒发送一次注释心跳帧', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      let release
      const gate = new Promise((resolve) => { release = resolve })
      service.sendMessageStream.mockReturnValue((async function* () {
        yield { type: 'sentence', text: '前半句。' }
        await gate
        yield { type: 'done', ...savedTurn }
      })())

      // supertest 在 then/end 时才真正发请求，用 end 显式启动
      const pending = new Promise((resolve, reject) => {
        request(app)
          .post('/conversations/conversation-1/messages/stream')
          .send({ content: '你好' })
          .end((error, response) => (error ? reject(error) : resolve(response)))
      })

      // setTimeout 未被 fake，轮询直到路由进入流式循环
      for (let attempt = 0; attempt < 100 && !service.sendMessageStream.mock.calls.length; attempt += 1) {
        await new Promise((resolve) => { setTimeout(resolve, 10) })
      }
      expect(service.sendMessageStream).toHaveBeenCalledOnce()

      await vi.advanceTimersByTimeAsync(15000)
      release()
      const response = await pending

      expect(response.text).toContain(': ping\n\n')
      expect(parseSseFrames(response.text).at(-1)).toEqual({ event: 'done', ...savedTurn })
    } finally {
      vi.useRealTimers()
    }
  })

  it('客户端断线时中止上游流', async () => {
    let capturedSignal
    service.sendMessageStream.mockImplementation((_id, _userId, _content, _requestId, { signal }) => {
      capturedSignal = signal
      return (async function* () {
        yield { type: 'sentence', text: '前半句。' }
        await new Promise(() => {})
      })()
    })

    const server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    try {
      await new Promise((resolve) => {
        const req = http.request({
          port: server.address().port,
          path: '/conversations/conversation-1/messages/stream',
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        }, (res) => {
          res.once('data', () => {
            req.destroy()
            resolve()
          })
          res.on('error', () => {})
        })
        req.on('error', () => {})
        req.end(JSON.stringify({ content: '你好' }))
      })

      await vi.waitFor(() => expect(capturedSignal.aborted).toBe(true))
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('空白与超长内容被参数校验拦截，不开启流', async () => {
    const blank = await request(app)
      .post('/conversations/conversation-1/messages/stream')
      .send({ content: '   ' })
    expect(blank.status).toBe(400)

    const tooLong = await request(app)
      .post('/conversations/conversation-1/messages/stream')
      .send({ content: 'x'.repeat(10001) })
    expect(tooLong.status).toBe(400)

    expect(service.sendMessageStream).not.toHaveBeenCalled()
  })
})
