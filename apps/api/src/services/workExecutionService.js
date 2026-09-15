import { docker, removeContainer } from './workContainerService.js'
export { reapWorkContainers, startWorkContainerReaper, stopWorkContainerReaper } from './workContainerService.js'
import { randomUUID } from 'node:crypto'
import { HttpError } from '../utils/dbHelpers.js'

const activeUsers = new Set()
const MAX_OUTPUT_BYTES = 18 * 1024 * 1024
const unavailable = () => new HttpError('隔离执行环境暂时不可用', 503)
const imageName = (env) => env.WORK_CODE_IMAGE || 'amie-work-python:20260915'
const SANDBOX_LABEL = 'app.amie.sandbox=python-v1'
const EXPIRY_LABEL = 'app.amie.expires-at'
const CONTAINER_LIFETIME_MS = 120000

export const isWorkCodeEnabled = (env = process.env) => env.WORK_CODE_ENABLED === 'true'

export async function workCodeStatus(env = process.env) {
  if (!isWorkCodeEnabled(env)) return { enabled: false, available: false }
  try {
    await docker(['image', 'inspect', imageName(env), '--format', '{{.Id}}'], { timeoutMs: 2000 })
    return { enabled: true, available: true }
  } catch { return { enabled: true, available: false } }
}

/** One ephemeral container, with explicit input bytes and no host mounts, network or credentials. */
export async function runWorkPython(userId, { code, files = [] }, { signal, env = process.env } = {}) {
  signal?.throwIfAborted()
  if (!isWorkCodeEnabled(env)) throw new HttpError('代码执行尚未启用', 503)
  if (typeof code !== 'string' || !code.trim() || code.length > 32000) throw new HttpError('代码需为 1–32000 个字符', 400)
  const image = imageName(env)
  if (!/^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,199}$/.test(image)) throw unavailable()
  if (!Array.isArray(files) || files.length > 8 || files.some((file) => !/^[A-Za-z0-9_-]{1,80}\.[a-z0-9]{1,8}$/.test(file.name)
    || typeof file.base64 !== 'string' || file.base64.length > 7 * 1024 * 1024)) throw new HttpError('执行输入文件无效', 400)
  const input = JSON.stringify({ code, files })
  if (Buffer.byteLength(input) > MAX_OUTPUT_BYTES) throw new HttpError('执行输入总量不能超过 12 MB', 400)
  if (activeUsers.has(userId) || activeUsers.size >= 2) throw new HttpError('执行环境正忙，请稍后重试', 429)
  activeUsers.add(userId)
  const name = `amie-work-${randomUUID()}`
  const expiresAt = Date.now() + CONTAINER_LIFETIME_MS
  const deadline = AbortSignal.timeout(45000)
  const executionSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
  let created = false
  try {
    // Finish creation before checking cancellation: an aborted request can never start a late-created container.
    const id = (await docker(['create', '-i', '--rm', '--pull=never', '--name', name,
      '--label', SANDBOX_LABEL, '--label', `${EXPIRY_LABEL}=${expiresAt}`, '--network', 'none', '--read-only',
      '--user', '65534:65534', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--memory', '512m', '--memory-swap', '512m', '--cpus', '1', '--pids-limit', '64',
      '--tmpfs', '/workspace:rw,nosuid,nodev,noexec,size=64m,uid=65534,gid=65534,mode=700',
      '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=32m,uid=65534,gid=65534,mode=700', image])).trim()
    if (!/^[a-f0-9]{64}$/.test(id)) throw unavailable()
    created = id
    executionSignal.throwIfAborted()
    if (Date.now() >= expiresAt) throw unavailable()
    const raw = await docker(['start', '-ai', name], { input, signal: executionSignal, timeoutMs: 45000, maxBytes: MAX_OUTPUT_BYTES })
    executionSignal.throwIfAborted()
    let result
    try { result = JSON.parse(raw) } catch { throw unavailable() }
    // Treat even the runner envelope as untrusted: generated code shares its container.
    if (!Number.isSafeInteger(result?.exitCode) || typeof result.stdout !== 'string' || result.stdout.length > 16000
      || typeof result.stderr !== 'string' || result.stderr.length > 8000 || !Array.isArray(result.files) || result.files.length > 8) throw unavailable()
    return { exitCode: result.exitCode, timedOut: result.timedOut === true, stdout: result.stdout, stderr: result.stderr,
      truncated: result.truncated === true, files: result.exitCode === 0 ? result.files : [] }
  } finally {
    // Await removal before releasing the slot or allowing the next model/tool round.
    try {
      if (created) await removeContainer(created)
      else await docker(['rm', '-f', name]).catch(() => {})
      executionSignal.throwIfAborted()
    } finally { activeUsers.delete(userId) }
  }
}
