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
