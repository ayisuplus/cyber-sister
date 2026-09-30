import { EventEmitter } from 'node:events'
/* global queueMicrotask */
import { PassThrough } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { publicUrl, resolvePublicTarget, readWebPage, readWebPages, readWebResource, extractWebText, submitWebResource, WEB_READ_TOOL } from './webReadService.js'

const publicAddress = { address: '93.184.216.34', family: 4 }
const lookup = vi.fn(async () => [publicAddress])
const submission = { url: 'https://example.com/save', method: 'POST', body: 'message=%E6%B5%8B%E8%AF%95', contentType: 'application/x-www-form-urlencoded', purpose: '提交测试反馈' }
const approval = () => ({ begin: vi.fn(async () => {}), complete: vi.fn(async () => {}), uncertain: vi.fn(async () => {}) })
function pages(...responses) {
  return vi.fn((_url, options, callback) => {
    const req = new EventEmitter()
    const response = new PassThrough()
    req.destroy = vi.fn(() => response.destroy())
    const page = responses.shift()
    queueMicrotask(() => {
      response.statusCode = page.status || 200
      response.headers = { 'content-type': 'text/html', ...page.headers }
      callback(response)
      if (!response.destroyed) response.end(page.body || '<html><head><title>Report</title></head><body><main>Public research evidence.</main></body></html>')
    })
    options.signal?.addEventListener('abort', () => { req.destroy(); req.emit('error', options.signal.reason) }, { once: true })
    return req
  })
}

describe('public web reading', () => {
  it('dispatches exactly the approved bytes after DNS and consent; does not inherit headers', async () => {
    const request = pages({ headers: { 'content-type': 'application/json' }, body: '{"saved":true}' })
    const grant = approval()
    const events = []
    grant.begin.mockImplementation(async actual => { expect(actual).toEqual(submission); events.push('approved') })
    const transport = (...args) => { events.push('sent'); return request(...args) }
    await submitWebResource(submission, { grant, request: transport, lookup: async () => { events.push('dns'); return [publicAddress] }, authorizeExternal: async () => true,
      headers: { Cookie: 'must-not-forward', Authorization: 'must-not-forward' } })
    expect(events).toEqual(['dns', 'approved', 'sent'])
    expect(request.mock.calls[0][1]).toMatchObject({ method: 'POST', body: Buffer.from(submission.body), headers: { 'Content-Type': submission.contentType, 'Content-Length': Buffer.byteLength(submission.body) } })
    expect(request.mock.calls[0][1].headers).not.toHaveProperty('Cookie')
    expect(grant.complete).toHaveBeenCalledWith(200)
    expect(grant.uncertain).not.toHaveBeenCalled()
  })

  it('cannot send without approval, after rejection, or with a partial/unreviewable body', async () => {
    const request = pages({})
    await expect(submitWebResource(submission, { request, lookup })).rejects.toMatchObject({ statusCode: 403 })
    const grant = approval()
    grant.begin.mockRejectedValue(new Error('rejected'))
    await expect(submitWebResource(submission, { grant, request, lookup, authorizeExternal: async () => true })).rejects.toThrow('rejected')
    await expect(submitWebResource({ ...submission, body: 'x'.repeat(8193) }, { grant, request })).rejects.toMatchObject({ statusCode: 400 })
    await expect(submitWebResource({ ...submission, method: 'CONNECT' }, { grant, request })).rejects.toMatchObject({ statusCode: 400 })
    expect(request).not.toHaveBeenCalled()
    expect(grant.uncertain).not.toHaveBeenCalled()
  })

  it('records uncertainty after dispatch errors and never retries or follows a write redirect', async () => {
    const grant = approval()
    const request = vi.fn(() => { throw new Error('connection lost') })
    await expect(submitWebResource(submission, { grant, request, lookup, authorizeExternal: async () => true })).rejects.toThrow('connection lost')
    expect(request).toHaveBeenCalledOnce()
    expect(grant.uncertain).toHaveBeenCalledOnce()
    const redirect = pages({ status: 307, headers: { location: 'http://127.0.0.1/private' } })
    const next = approval()
    await expect(submitWebResource(submission, { grant: next, request: redirect, lookup, authorizeExternal: async () => true })).rejects.toMatchObject({ statusCode: 400 })
    expect(redirect).toHaveBeenCalledOnce()
    expect(next.complete).toHaveBeenCalledWith(307)
    expect(next.uncertain).not.toHaveBeenCalled()
  })

  it('cancellation at consumption prevents the socket; ordinary readers remain GET-only', async () => {
    const controller = new AbortController()
    const grant = approval()
    grant.begin.mockImplementation(async () => controller.abort())
    const request = pages({})
    await expect(submitWebResource(submission, { grant, request, lookup, signal: controller.signal, authorizeExternal: async () => true })).rejects.toMatchObject({ name: 'AbortError' })
    expect(request).not.toHaveBeenCalled()
    expect(grant.uncertain).toHaveBeenCalledOnce()
    await readWebResource(submission.url, { lookup, request, method: 'DELETE', requestBody: Buffer.from('secret') })
    expect(request.mock.calls[0][1].method).toBe('GET')
    expect(request.mock.calls[0][1]).not.toHaveProperty('body')
  })
  it.each(['file:///etc/passwd', 'http://127.0.0.1', 'http://2130706433', 'http://[::1]', 'http://[::ffff:127.0.0.1]',
    'http://169.254.169.254', 'http://10.0.0.1', 'http://localhost', 'https://a.local', 'https://user:pass@example.com', 'https://example.com:3000'])('rejects non-public target %s', (url) => {
    expect(() => publicUrl(url)).toThrow()
  })

  it('rejects mixed public/private DNS results and normalizes DNS failures', async () => {
    await expect(resolvePublicTarget(new URL('https://example.com'), async () => [publicAddress, { address: '192.168.1.1', family: 4 }])).rejects.toMatchObject({ statusCode: 400 })
    await expect(resolvePublicTarget(new URL('https://example.com'), async () => { throw new Error('private resolver detail') })).rejects.toMatchObject({ message: '网页暂时无法读取，请换一个来源', statusCode: 503 })
  })

  it('pins DNS to the validated address and supplies a real source without executing page scripts', async () => {
    const request = pages({ body: '<html><head><title>Trusted title</title></head><body><nav>Menus</nav><main><p>Actual evidence.</p><script>globalThis.pwned = true</script></main></body></html>' })
    const authorizeExternal = vi.fn(async () => true)
    const result = await readWebPage('https://example.com/report#section', { lookup, request, authorizeExternal })
    expect(result).toMatchObject({ source: { title: 'Trusted title', url: 'https://example.com/report' }, content: expect.stringContaining('Actual evidence.') })
    expect(result.content).not.toMatch(/Menus|pwned/)
    const pinned = vi.fn()
    request.mock.calls[0][1].lookup('example.com', { all: true }, pinned)
    expect(pinned).toHaveBeenCalledWith(null, [publicAddress])
    expect(authorizeExternal).toHaveBeenCalledTimes(2)
  })

  it('rejects redirects into private DNS before making a second request', async () => {
    const request = pages({ status: 302, headers: { location: 'https://private.example/report' } })
    const resolve = vi.fn(async (host) => host === 'private.example' ? [{ address: '10.1.1.1', family: 4 }] : [publicAddress])
    await expect(readWebPage('https://example.com', { lookup: resolve, request })).rejects.toMatchObject({ statusCode: 400 })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('rechecks consent after DNS, and never makes HTTP requests after revocation', async () => {
    const request = pages({})
    const authorizeExternal = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    await expect(readWebPage('https://example.com', { lookup, request, authorizeExternal })).rejects.toMatchObject({ statusCode: 403 })
    expect(request).not.toHaveBeenCalled()
  })

  it('cancels while waiting for DNS without starting HTTP', async () => {
    const controller = new AbortController()
    const request = pages({})
    const task = readWebPage('https://example.com', { lookup: () => new Promise(() => {}), request, signal: controller.signal })
    controller.abort()
    await expect(task).rejects.toMatchObject({ name: 'AbortError' })
    expect(request).not.toHaveBeenCalled()
  })

  it('bounds decoded bytes, including compressed responses', async () => {
    const request = pages({ body: gzipSync(Buffer.alloc(2 * 1024 * 1024 + 1, 'a')), headers: { 'content-encoding': 'gzip' } })
    await expect(readWebPage('https://example.com', { lookup, request })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('limits redirects and rejects binary content', async () => {
    const request = pages(...Array.from({ length: 4 }, () => ({ status: 302, headers: { location: '/next' } })))
    await expect(readWebPage('https://example.com', { lookup, request })).rejects.toMatchObject({ statusCode: 400 })
    await expect(readWebPage('https://example.com', { lookup, request: pages({ headers: { 'content-type': 'application/pdf' } }) })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('extracts text and identifies empty pages honestly', () => {
    expect(extractWebText('plain content', 'https://example.com', 'text/plain').text).toBe('plain content')
    expect(() => extractWebText('<html><body><script>load()</script></body></html>', 'https://example.com')).toThrow('没有可读取的正文')
  })

  it('browser resources preserve bytes, status and CSP without accepting or returning cookies', async () => {
    const bytes = Buffer.from([137, 80, 78, 71, 255, 0, 192])
    const request = pages({ body: bytes, headers: { 'content-type': 'image/png', 'set-cookie': 'private=session',
      'content-security-policy': "default-src 'self'", 'x-private-header': 'secret' } })
    const result = await readWebResource('https://example.com/image.png', { lookup, request })
    expect(result.body).toEqual(bytes)
    expect(result.status).toBe(200)
    expect(result.headers).toEqual({ 'content-type': 'image/png', 'content-security-policy': "default-src 'self'" })
    expect(request.mock.calls[0][1].headers).not.toHaveProperty('Cookie')
    const pinned = vi.fn()
    request.mock.calls[0][1].lookup('example.com', {}, pinned)
    expect(pinned).toHaveBeenCalledWith(null, publicAddress.address, 4)
  })

  it('browser redirects are returned one hop at a time and literal private targets are rejected', async () => {
    const result = await readWebResource('https://example.com/page', { lookup, request: pages({ status: 302, headers: { location: '/next' } }) })
    expect(result).toEqual({ status: 302, body: Buffer.alloc(0), headers: { location: 'https://example.com/next' } })
    await expect(readWebResource('https://example.com', { lookup, request: pages({ status: 302, headers: { location: 'http://127.0.0.1/' } }) }))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('browser resources use the same DNS, revocation and decompression boundaries', async () => {
    const request = pages({})
    await expect(readWebResource('https://example.com', { request, lookup: async () => [{ address: '10.0.0.1', family: 4 }] })).rejects.toMatchObject({ statusCode: 400 })
    await expect(readWebResource('https://example.com', { request, lookup, authorizeExternal: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false) })).rejects.toMatchObject({ statusCode: 403 })
    expect(request).not.toHaveBeenCalled()
    await expect(readWebResource('https://example.com', { lookup, request: pages({ body: gzipSync(Buffer.alloc(2 * 1024 * 1024 + 1)), headers: { 'content-type': 'text/javascript', 'content-encoding': 'gzip' } }) }))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('browser can render public HTTP error pages while static article reading still rejects them', async () => {
    expect((await readWebResource('https://example.com', { lookup, request: pages({ status: 404, body: 'Not found' }) })).status).toBe(404)
    await expect(readWebPage('https://example.com', { lookup, request: pages({ status: 404 }) })).rejects.toMatchObject({ statusCode: 503 })
  })
})

describe('read_web 的 urls 模式：一次并发读多页', () => {
  const page = (url) => ({ source: { url, title: url }, content: '正文'.repeat(10) })

  it('并发读取、一页失败不拖垮其它页，结果与 hrefs 同序', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const readPage = vi.fn((href) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      return new Promise((resolve, reject) => setTimeout(() => {
        inFlight -= 1
        if (href.includes('bad')) reject(new Error('网页暂时无法读取，请换一个来源'))
        else resolve(page(href))
      }, 10))
    })

    const outcomes = await readWebPages(['https://a.example/1', 'https://bad.example/2', 'https://c.example/3'], { readPage })

    expect(maxInFlight).toBe(3)
    expect(outcomes.map((outcome) => Boolean(outcome.page))).toEqual([true, false, true])
    expect(outcomes[0].page.source.url).toBe('https://a.example/1')
    expect(outcomes[1]).toEqual({ href: 'https://bad.example/2', error: '网页暂时无法读取，请换一个来源' })
    expect(outcomes[2].page.source.url).toBe('https://c.example/3')
  })

  it('urls 模式每页先给 6000 字符并标 untrusted，全部读不成如实 503（这里只验未注入 reader 的失败口径）', async () => {
    // 公共地址但不存在的域名：读取失败走全失败分支，不碰真实网络之外的桩
    await expect(WEB_READ_TOOL.run('u1', { urls: ['https://nonexistent-domain-for-test.example/1'] }, { workspace: {} }))
      .rejects.toMatchObject({ statusCode: 503 })
  })

  it('url 与 urls 互斥、空 urls、超上限与非法 offset 都拦在读取前', async () => {
    await expect(WEB_READ_TOOL.run('u1', { url: 'https://a.example', urls: ['https://b.example'] }, { workspace: {} }))
      .rejects.toMatchObject({ message: 'url 与 urls 只能给一个' })
    await expect(WEB_READ_TOOL.run('u1', { urls: [] }, { workspace: {} }))
      .rejects.toMatchObject({ message: 'urls 不能为空' })
    await expect(WEB_READ_TOOL.run('u1', { urls: Array.from({ length: 5 }, (_, i) => 'https://a.example/' + i) }, { workspace: {} }))
      .rejects.toMatchObject({ message: '一次最多读取 4 个网页' })
    await expect(WEB_READ_TOOL.run('u1', {}, { workspace: {} }))
      .rejects.toMatchObject({ message: '缺少 url 或 urls' })
    await expect(WEB_READ_TOOL.run('u1', { url: 'https://a.example', offset: -1 }, { workspace: {} }))
      .rejects.toMatchObject({ message: '读取偏移无效' })
  })
})
