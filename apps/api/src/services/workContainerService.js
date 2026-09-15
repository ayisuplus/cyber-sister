import { spawn } from 'node:child_process'
import { HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'

const unavailable = () => new HttpError('隔离执行环境暂时不可用', 503)
const EXPIRY_LABEL = 'app.amie.expires-at'
let reaperTimer = null
let reaping = null
const enabledKinds = env => [
  ...(env.WORK_CODE_ENABLED === 'true' ? ['python-v1'] : []),
  ...(env.WORK_BROWSER_ENABLED === 'true' ? ['browser-v1'] : []),
]

export function docker(args, { input, signal, timeoutMs = 10000, maxBytes = 8192 } = {}) {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    let size = 0
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (error) { child.kill(); reject(error) } else resolve(value)
    }
    const abort = () => finish(signal.reason)
    const timer = setTimeout(() => finish(unavailable()), timeoutMs)
    timer.unref?.()
    signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) { finish(new HttpError('执行输出超过限制', 400)); return }
      output += chunk.toString('utf8')
    })
    child.stderr.on('data', () => {})
    child.on('error', () => finish(unavailable()))
    child.stdin.on('error', () => {})
    child.on('close', (code) => finish(code === 0 ? null : unavailable(), output))
    if (signal?.aborted) { abort(); return }
    child.stdin.end(input)
  })
}

export async function removeContainer(id) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw unavailable()
  try { await docker(['rm', '-f', id]) } catch (error) {
    // --rm and another API's reaper can win the race. Only verified absence is success.
    const remaining = await docker(['ps', '-a', '--no-trunc', '--filter', `id=${id}`, '--format', '{{.ID}}'])
    if (remaining.trim()) throw error
  }
}

export async function reapWorkContainers(env = process.env) {
  const outputs = await Promise.all(enabledKinds(env).map(kind => docker(['ps', '-a', '--no-trunc', '--filter', `label=app.amie.sandbox=${kind}`,
    '--format', `{{.ID}} {{.Label "${EXPIRY_LABEL}"}}`], { maxBytes: 65536 })))
  const expired = outputs.join('\n').trim().split('\n').flatMap((line) => {
    const match = /^([a-f0-9]{64}) (\d{13})$/.exec(line.trim())
    return match && Number(match[2]) <= Date.now() ? [match[1]] : []
  }).slice(0, 10)
  const results = await Promise.allSettled(expired.map(removeContainer))
  if (results.some((result) => result.status === 'rejected')) throw unavailable()
  return expired.length
}

export function startWorkContainerReaper() {
  if (reaperTimer || !enabledKinds(process.env).length) return
  const tick = () => {
    if (reaping) return
    reaping = reapWorkContainers().catch(() => logger.warn('隔离执行容器回收暂时不可用'))
      .finally(() => { reaping = null })
  }
  reaperTimer = setInterval(tick, 30000)
  reaperTimer.unref()
  tick()
}

export async function stopWorkContainerReaper() {
  clearInterval(reaperTimer)
  reaperTimer = null
  await reaping
}
