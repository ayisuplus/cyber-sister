import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import logger from './logger.js'

describe('logger 元信息过滤', () => {
  let logSpy

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function loggedMeta() {
    expect(logSpy).toHaveBeenCalledOnce()
    const line = logSpy.mock.calls[0][0]
    const jsonStart = line.indexOf('{')
    return JSON.parse(line.slice(jsonStart))
  }

  it('错误与业务标识键被保留', () => {
    logger.info('测试', {
      error: 'boom',
      code: 'SOME_CODE',
      reason: 'because',
      userId: 'u1',
      conversationId: 'c1',
      stack: 'Error: boom\n  at x',
    })
    expect(loggedMeta()).toEqual({
      error: 'boom',
      code: 'SOME_CODE',
      reason: 'because',
      userId: 'u1',
      conversationId: 'c1',
      stack: 'Error: boom\n  at x',
    })
  })

  it('白名单外的键（如 phone、token）仍被过滤', () => {
    logger.info('测试', {
      requestId: 'r1',
      phone: '13800138000',
      token: 'secret-token',
      password: 'p',
    })
    expect(loggedMeta()).toEqual({ requestId: 'r1' })
  })

  it('超过 200 字符的字符串值被截断', () => {
    logger.info('测试', { error: 'x'.repeat(500) })
    const meta = loggedMeta()
    expect(meta.error).toHaveLength(201)
    expect(meta.error.endsWith('…')).toBe(true)
    expect(meta.error.startsWith('x'.repeat(200))).toBe(true)
  })

  it('undefined 值被丢弃，非字符串值原样保留', () => {
    logger.info('测试', { latencyMs: 12, error: undefined })
    expect(loggedMeta()).toEqual({ latencyMs: 12 })
  })

  it('无元信息时不追加 JSON 片段', () => {
    logger.info('纯文本消息')
    expect(logSpy.mock.calls[0][0]).not.toContain('{')
  })
})
describe('requestLogger 请求追踪', () => {
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

  function run(headers) {
    const req = { headers }
    const res = { setHeader: vi.fn(), on: vi.fn(), statusCode: 200 }
    const next = vi.fn()
    logger.requestLogger()(req, res, next)
    return { req, res, next }
  }

  it('合法的入站 X-Request-Id 被透传到请求与响应头', () => {
    const { req, res, next } = run({ 'x-request-id': 'makeup-req-abc123' })
    expect(req.requestId).toBe('makeup-req-abc123')
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'makeup-req-abc123')
    expect(next).toHaveBeenCalledOnce()
  })

  it('无入站头时生成 UUID 兜底', () => {
    const { req, res } = run({})
    expect(req.requestId).toMatch(UUID_PATTERN)
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.requestId)
  })

  it.each([
    ['包含注入字符', 'evil\r\nX-Injected: yes'],
    ['超过 64 字符', 'a'.repeat(65)],
    ['包含空格', 'not valid'],
    ['包含下划线', 'bad_id'],
    ['非字符串', 12345],
  ])('非法入站头（%s）被丢弃并重新生成', (_label, value) => {
    const { req, res } = run({ 'x-request-id': value })
    expect(req.requestId).toMatch(UUID_PATTERN)
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.requestId)
  })
})
