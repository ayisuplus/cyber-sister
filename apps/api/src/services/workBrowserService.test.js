/* global queueMicrotask */
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), docker: vi.fn(), remove: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('./workContainerService.js', () => ({ docker: mocks.docker, removeContainer: mocks.remove }))
import { createWorkBrowser, workBrowserStatus } from './workBrowserService.js'

const env = { WORK_BROWSER_ENABLED: 'true' }
const sessions = []
const children = []
const authorizeExternal = vi.fn(async () => true)
const page = { url: 'https://example.com/', title: '测试页面', content: '动态内容', controls: [{ ref: '1:1', name: '按钮', role: 'button' }] }
function child(onMessage = (child, message) => {
  if (message.operation) child.stdout.write(`${JSON.stringify({ event: 'result', id: message.id, result: page })}\n`)
}) {
  const value = new EventEmitter()
  value.stdin = new PassThrough(); value.stdout = new PassThrough(); value.stderr = new PassThrough()
  value.kill = vi.fn()
  value.messages = []
  value.stdin.on('data', data => {
    const message = JSON.parse(data.toString())
    value.messages.push(message)
    onMessage(value, message)
  })
  queueMicrotask(() => value.stdout.write('{"event":"ready"}\n'))
  children.push(value)
  return value
}
async function open(options = {}, user = 'user-one') {
  const session = await createWorkBrowser(user, { env, authorizeExternal, ...options })
  sessions.push(session)
  return session
}
beforeEach(() => {
  vi.clearAllMocks()
  authorizeExternal.mockResolvedValue(true)
  mocks.docker.mockResolvedValue('a'.repeat(64))
  mocks.remove.mockResolvedValue(undefined)
  mocks.spawn.mockImplementation(() => child())
})
afterEach(async () => {
  await Promise.allSettled(sessions.splice(0).map(session => session.close()))
  children.length = 0
})

describe('work browser runtime boundaries', () => {
  it('requires an active submission command and rejects a premature result while confirmation is pending', async () => {
    const requestAction = vi.fn(async (_value) => new Promise(() => {}))
    const submitResource = vi.fn()
    mocks.spawn.mockImplementation(() => child((value, message) => {
      if (message.operation) {
        value.stdout.write(`${JSON.stringify({ event: 'resource', id: 1, commandId: message.id, method: 'POST', url: 'https://example.com/save', base64: '', contentType: 'text/plain' })}\n`)
      }
    }))
    const session = await open({ env: { ...env, WORK_BROWSER_WRITES_ENABLED: 'true' }, requestAction, submitResource })
    const result = session.command('act', { action: 'click', ref: '1:1', submit: true, purpose: '提交合成内容' })
    const rejected = expect(result).rejects.toMatchObject({ statusCode: 503 })
    await vi.waitFor(() => expect(requestAction).toHaveBeenCalledOnce())
    children[0].stdout.write(`${JSON.stringify({ event: 'result', id: 1, result: page })}\n`)
    await rejected
    expect(submitResource).not.toHaveBeenCalled()
    await session.close()
  })

  it('a caller cannot enable submissions by supplying a callback when the instance flag is off', async () => {
    const requestAction = vi.fn()
    const session = await open({ requestAction })
    await expect(session.command('act', { action: 'click', ref: '1:1', submit: true, purpose: '提交' })).rejects.toMatchObject({ statusCode: 403 })
    expect(children[0].messages).toHaveLength(0)
    expect(requestAction).not.toHaveBeenCalled()
  })
  it('requires enablement and fresh authorization before Docker', async () => {
    expect(await workBrowserStatus('user-one', {})).toMatchObject({ enabled: false, available: false, running: false })
    await expect(createWorkBrowser('u', { env: {} })).rejects.toMatchObject({ statusCode: 503 })
    await expect(createWorkBrowser('u', { env })).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.docker).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('creates only a bounded container without host mounts, ports or inherited credentials', async () => {
    const session = await open()
    const args = mocks.docker.mock.calls[0][0]
    expect(args).toEqual(expect.arrayContaining(['--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--memory', '768m', '--user', '1000:1000']))
    expect(args).not.toContain('-p'); expect(args).not.toContain('-v'); expect(args).not.toContain('--env')
    expect(args.some(arg => arg.startsWith('seccomp=') && arg.endsWith('seccomp_profile.json'))).toBe(true)
    expect(await workBrowserStatus('another-user', env)).toMatchObject({ running: false, available: true })
    expect(await workBrowserStatus(session.userId, env)).toMatchObject({ running: true })
  })

  it('rejects invalid actions and private navigation without sending a browser command', async () => {
    const session = await open()
    await expect(session.command('open', { url: 'http://127.0.0.1/' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(session.command('act', { action: 'evaluate', value: 'process.env' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(session.command('act', { action: 'press', ref: '1:1', key: 'Control+L' })).rejects.toMatchObject({ statusCode: 400 })
    expect(children[0].messages).toHaveLength(0)
  })

  it('reassembles split UTF-8 and validates the returned public page', async () => {
    mocks.spawn.mockImplementation(() => child((value, message) => {
      const bytes = Buffer.from(`${JSON.stringify({ event: 'result', id: message.id, result: page })}\n`)
      const boundary = bytes.indexOf(Buffer.from('测试')) + 1
      value.stdout.write(bytes.subarray(0, boundary)); value.stdout.write(bytes.subarray(boundary))
    }))
    const session = await open()
    expect(await session.command('open', { url: page.url })).toEqual(page)
  })

  it('cancellation during container creation removes it and never starts a late browser', async () => {
    const controller = new AbortController()
    mocks.docker.mockImplementation(async () => { controller.abort(); return 'a'.repeat(64) })
    await expect(open({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenCalledWith('a'.repeat(64))
  })

  it('blocked resource targets never reach HTTP and resource messages cannot supply cookies', async () => {
    const fetchResource = vi.fn(async () => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: Buffer.from('ok') }))
    await open({ fetchResource })
    children[0].stdout.write('{"event":"resource","id":1,"url":"http://169.254.169.254/","method":"GET"}\n')
    await vi.waitFor(() => expect(children[0].messages).toHaveLength(1))
    expect(fetchResource).not.toHaveBeenCalled()
    children[0].stdout.write('{"event":"resource","id":2,"url":"https://example.com/","method":"GET","headers":{"Cookie":"secret"}}\n')
    await vi.waitFor(() => expect(fetchResource).toHaveBeenCalledOnce())
    expect(Object.keys(fetchResource.mock.calls[0][1]).sort()).toEqual(['authorizeExternal', 'signal'])
  })

  it('revocation closes the browser before accepting another operation', async () => {
    const session = await open()
    authorizeExternal.mockResolvedValue(false)
    await expect(session.command('snapshot')).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.remove).toHaveBeenCalledOnce()
    expect(children[0].messages).toHaveLength(0)
  })

  it('cancelled commands discard late results; close waits for confirmed container removal', async () => {
    mocks.spawn.mockImplementation(() => child(() => {}))
    const controller = new AbortController()
    const session = await open({ signal: controller.signal })
    let removed
    mocks.remove.mockImplementation(() => new Promise(resolve => { removed = resolve }))
    const command = session.command('snapshot')
    const rejection = expect(command).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(children[0].messages).toHaveLength(1))
    controller.abort()
    await rejection
    children[0].stdout.write(`${JSON.stringify({ event: 'result', id: 1, result: page })}\n`)
    const closed = vi.fn()
    const cleanup = session.close().then(closed)
    await Promise.resolve()
    expect(closed).not.toHaveBeenCalled()
    removed()
    await cleanup
    expect(closed).toHaveBeenCalledOnce()
  })

  it('malformed protocol and forged non-public snapshots cannot be returned as browser results', async () => {
    mocks.spawn.mockImplementation(() => child((value, message) => value.stdout.write(`${JSON.stringify({ event: 'result', id: message.id, result: { ...page, url: 'file:///private' } })}\n`)))
    const session = await open()
    await expect(session.command('snapshot')).rejects.toMatchObject({ statusCode: 400 })
    await session.close()
    expect(mocks.remove).toHaveBeenCalledOnce()
  })
})
