import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { StringDecoder } from 'node:string_decoder'
import { TextDecoder } from 'node:util'
import { HttpError } from '../utils/dbHelpers.js'
import { docker, removeContainer } from './workContainerService.js'
import { publicUrl, readWebResource, submitWebResource, browserActionRequest } from './webReadService.js'

const activeUsers = new Map()
const MAX_RESOURCE_BYTES = 2 * 1024 * 1024
const unavailable = () => new HttpError('浏览器暂时不可用，请重新打开网页', 503)
const imageName = env => env.WORK_BROWSER_IMAGE || 'amie-work-browser:20260915'
const profile = fileURLToPath(new URL('../../work-browser-runtime/seccomp_profile.json', import.meta.url))
export const isWorkBrowserEnabled = (env = process.env) => env.WORK_BROWSER_ENABLED === 'true'
export const isWorkBrowserWriteEnabled = (env = process.env) => env.WORK_BROWSER_WRITES_ENABLED === 'true'

async function authorized(context) {
  context.signal.throwIfAborted()
  if (!context.authorizeExternal || await context.authorizeExternal() !== true) throw new HttpError('网页浏览授权已撤回', 403)
  context.signal.throwIfAborted()
}

function validateCommand(operation, args) {
  if (operation === 'open') { publicUrl(args.url); return }
  if (operation === 'snapshot') {
    if (args.screenshot !== undefined && typeof args.screenshot !== 'boolean') throw new HttpError('截图参数无效', 400)
    return
  }
  if (operation !== 'act' || !['click', 'fill', 'select', 'press', 'scroll'].includes(args.action)) throw new HttpError('页面操作无效', 400)
  if (args.submit !== undefined && typeof args.submit !== 'boolean') throw new HttpError('提交参数无效', 400)
  if (args.submit && (typeof args.purpose !== 'string' || !args.purpose.trim() || args.purpose.length > 160)) throw new HttpError('请说明此次提交的目的', 400)
  if (args.action === 'scroll') {
    if (!['up', 'down'].includes(args.direction)) throw new HttpError('滚动方向无效', 400)
    return
  }
  if (typeof args.ref !== 'string' || !/^\d{1,7}:\d{1,3}$/.test(args.ref)) throw new HttpError('请使用最近页面返回的控件编号', 400)
  if (['fill', 'select'].includes(args.action) && (typeof args.value !== 'string' || args.value.length > 1000)) throw new HttpError('填写内容最多 1000 个字符', 400)
  if (args.action === 'press' && !['Enter', 'Tab', 'Escape', 'Space', 'ArrowDown', 'ArrowUp'].includes(args.key)) throw new HttpError('该按键未开放', 400)
}

function validateSnapshot(result) {
  if (!result || typeof result.title !== 'string' || result.title.length > 200 || typeof result.content !== 'string' || result.content.length > 18000
    || !Array.isArray(result.controls) || result.controls.length > 200 || result.controls.some(control => typeof control.ref !== 'string'
      || !/^\d{1,7}:\d{1,3}$/.test(control.ref) || typeof control.name !== 'string' || control.name.length > 160)) throw unavailable()
  publicUrl(result.url)
  if (result.screenshot !== undefined && (typeof result.screenshot !== 'string' || result.screenshot.length > 7 * 1024 * 1024)) throw unavailable()
  return result
}

class BrowserSession {
  constructor(id, userId, options) {
    this.id = id
    this.userId = userId
    this.options = options
    this.controller = new AbortController()
    this.signal = AbortSignal.any([options.signal, this.controller.signal])
    this.pending = new Map()
    this.nextId = 0
    this.resourceIds = new Set()
    this.resourceQueue = []
    this.resourceCount = 0
    this.resourceBytes = 0
    this.closed = null
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject })
    this.child = spawn('docker', ['start', '-ai', id], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const decoder = new StringDecoder('utf8')
    let buffer = ''
    this.child.stdout.on('data', chunk => {
      buffer += decoder.write(chunk)
      if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) { this.fail(unavailable()); return }
      for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        try { this.receive(JSON.parse(line)) } catch { this.fail(unavailable()) }
      }
    })
    this.child.stderr.on('data', () => {})
    this.child.stdin.on('error', () => this.fail(unavailable()))
    this.child.on('error', () => this.fail(unavailable()))
    this.child.on('close', () => this.fail(unavailable()))
    this.startTimeout = setTimeout(() => this.fail(unavailable()), 25000)
    this.startTimeout.unref()
    this.abort = () => this.fail(this.signal.reason)
    this.signal.addEventListener('abort', this.abort, { once: true })
    if (this.signal.aborted) this.abort()
  }

  send(message) {
    this.signal.throwIfAborted()
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  receive(message) {
    if (this.signal.aborted || this.closed) return
    if (message.event === 'ready') { clearTimeout(this.startTimeout); this.resolveReady(); return }
    if (message.event === 'resource') {
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(message.method) || !Number.isSafeInteger(message.id) || message.id < 1 || this.resourceIds.has(message.id)
        || this.resourceIds.size >= 120 || typeof message.url !== 'string' || message.url.length > 2048) throw unavailable()
      const pending = message.method !== 'GET' || message.review === true ? this.pending.get(message.commandId) : null
      if (message.method !== 'GET' || message.review === true) {
        if (!pending?.submit) throw unavailable()
        pending.submissions = (pending.submissions || 0) + 1
      }
      this.resourceIds.add(message.id)
      this.resourceQueue.push({ ...message, pending })
      this.pumpResources()
      return
    }
    if (message.event !== 'result') throw unavailable()
    const pending = this.pending.get(message.id)
    if (!pending || pending.submissions) throw unavailable()
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) {
      pending.reject(new HttpError(message.error === 'STALE_REFERENCE' ? '页面控件已变化，请重新读取页面' : '网页加载或操作未成功，请检查当前页面', 400))
    } else {
      try { pending.resolve(validateSnapshot(message.result)) } catch (error) { pending.reject(error); this.fail(error) }
    }
  }

  pumpResources() {
    while (!this.signal.aborted && this.resourceCount < 6 && this.resourceQueue.length) {
      const request = this.resourceQueue.shift()
      this.resourceCount += 1
      void this.fetchResource(request).catch(() => { /* Failure is reported to the intercepted request. */ })
        .finally(() => { if (request.pending) request.pending.submissions -= 1; this.resourceCount -= 1; this.pumpResources() })
    }
  }

  async fetchResource(request) {
    try {
      // A compromised page/worker still cannot select private targets or forward browser credentials.
      publicUrl(request.url)
      await authorized(this)
      let response
      if (request.method !== 'GET' || request.review === true) {
        const pending = this.pending.get(request.commandId)
        if (!pending?.submit || !this.options.requestAction) throw new HttpError('此次提交未开放确认', 403)
        if (typeof request.base64 !== 'string' || request.base64.length > 12000) throw new HttpError('提交内容过大', 400)
        const bytes = Buffer.from(request.base64, 'base64')
        if (bytes.toString('base64') !== request.base64) throw new HttpError('提交内容编码无效', 400)
        const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        const value = browserActionRequest({ url: request.url, method: request.method, body, contentType: request.contentType || '', purpose: pending.purpose })
        const grant = await this.options.requestAction(value)
        await authorized(this)
        if (this.pending.get(request.commandId) !== pending) throw new HttpError('页面操作已结束，此次提交已失效', 409)
        response = await (this.options.submitResource || submitWebResource)(value, { signal: this.signal, authorizeExternal: this.options.authorizeExternal, grant })
      } else {
        response = await (this.options.fetchResource || readWebResource)(request.url, { signal: this.signal, authorizeExternal: this.options.authorizeExternal })
      }
      this.signal.throwIfAborted()
      if (!Buffer.isBuffer(response.body) || response.body.length > MAX_RESOURCE_BYTES) throw unavailable()
      this.resourceBytes += response.body.length
      if (this.resourceBytes > 24 * 1024 * 1024) { this.fail(unavailable()); return }
      this.send({ event: 'resource', id: request.id, status: response.status, headers: response.headers, base64: response.body.toString('base64') })
    } catch (error) {
      if (error.statusCode === 403) { this.fail(error); return }
      if (!this.signal.aborted) this.send({ event: 'resource', id: request.id, error: true })
    }
  }

  get authorizeExternal() { return this.options.authorizeExternal }

  async command(operation, args = {}) {
    validateCommand(operation, args)
    if (args.submit && !this.options.requestAction) throw new HttpError('提交网页内容请启用后台任务确认', 403)
    try { await authorized(this) } catch (error) { await this.close(); throw error }
    await this.ready
    this.signal.throwIfAborted()
    if (this.pending.size) throw new HttpError('当前页面操作尚未完成', 409)
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(unavailable()), args.submit ? 330000 : 35000)
      timer.unref()
      this.pending.set(id, { resolve, reject, timer, submit: args.submit === true, purpose: args.purpose })
      try { this.send({ id, operation, args }) } catch (error) { this.fail(error) }
    })
  }

  fail(error) {
    this.rejectReady(error)
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this.pending.clear()
    void this.close().catch(() => {})
  }

  close() {
    if (this.closed) return this.closed
    this.closed = Promise.resolve().then(async () => {
      clearTimeout(this.startTimeout)
      this.signal.removeEventListener('abort', this.abort)
      this.controller.abort()
      this.resourceQueue = []
      this.rejectReady(this.signal.reason)
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(this.signal.reason) }
      this.pending.clear()
      this.child.kill()
      try { await removeContainer(this.id) } finally {
        if (activeUsers.get(this.userId) === this) activeUsers.delete(this.userId)
      }
    })
    return this.closed
  }
}

export async function createWorkBrowser(userId, options = {}) {
  const env = options.env || process.env
  if (!isWorkBrowserEnabled(env)) throw new HttpError('网页浏览尚未启用', 503)
  const image = imageName(env)
  if (!/^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,199}$/.test(image)) throw unavailable()
  const requestAction = isWorkBrowserWriteEnabled(env) ? options.requestAction : undefined
  const lifetime = requestAction ? 600000 : 180000
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(lifetime)]) : AbortSignal.timeout(lifetime)
  await authorized({ signal, authorizeExternal: options.authorizeExternal })
  if (activeUsers.has(userId) || activeUsers.size >= 2) throw new HttpError('浏览器正忙，请稍后重试', 429)
  activeUsers.set(userId, null)
  const name = `amie-browser-${randomUUID()}`
  const expiresAt = Date.now() + lifetime + 60000
  let id
  let session
  try {
    id = (await docker(['create', '-i', '--rm', '--pull=never', '--name', name,
      '--label', 'app.amie.sandbox=browser-v1', '--label', `app.amie.expires-at=${expiresAt}`,
      '--network', 'none', '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--security-opt', `seccomp=${profile}`, '--memory', '768m', '--memory-swap', '768m', '--cpus', '1', '--pids-limit', '128',
      '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=256m,uid=1000,gid=1000,mode=700', image, ...(requestAction ? ['--with-approvals'] : [])])).trim()
    if (!/^[a-f0-9]{64}$/.test(id)) throw unavailable()
    signal.throwIfAborted()
    if (Date.now() >= expiresAt) throw unavailable()
    session = new BrowserSession(id, userId, { ...options, signal, requestAction })
    activeUsers.set(userId, session)
    await session.ready
    signal.throwIfAborted()
    return session
  } catch (error) {
    try {
      if (session) await session.close()
      else if (/^[a-f0-9]{64}$/.test(id || '')) await removeContainer(id)
      else await docker(['rm', '-f', name]).catch(() => {})
    } finally { activeUsers.delete(userId) }
    throw error
  }
}

export async function workBrowserStatus(userId, env = process.env) {
  const status = { enabled: isWorkBrowserEnabled(env), available: false, running: Boolean(activeUsers.get(userId)), headed: false }
  if (!status.enabled) return status
  try {
    await docker(['image', 'inspect', imageName(env), '--format', '{{.Id}}'], { timeoutMs: 2000 })
    return { ...status, available: true }
  } catch { return status }
}
