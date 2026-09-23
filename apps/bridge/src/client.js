/**
 * 与 Amie 服务端往来：用连接码换令牌；之后长轮询取任务、在授权文件夹里执行、交回结果。
 * 只由这台电脑主动发起连接，不开放任何端口。每件事都在终端里写一行，用户看得见她在做什么。
 */
import { handleJob } from './folder.js'

const MAX_BACKOFF_MS = 30_000

/** 生产环境只允许 https；本机调试可用 localhost。 */
export function normalizeServer(server) {
  let url
  try { url = new URL(String(server)) } catch { throw new Error('Amie 的网址不对，例如 https://amie.example.com') }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('为了安全，Amie 的网址需要以 https:// 开头')
  return url.origin
}

async function errorMessage(response, fallback) {
  try { return (await response.json())?.error || fallback } catch { return fallback }
}

export async function pair({ server, code, name, fetchImpl = fetch }) {
  const response = await fetchImpl(`${normalizeServer(server)}/api/bridge/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name }),
  })
  if (!response.ok) throw new Error(await errorMessage(response, '配对失败'))
  return response.json()
}

export function describeJob(job) {
  const target = job?.args?.path ? `「${job.args.path}」` : '授权文件夹'
  if (job?.tool === 'list') return `Amie 在看 ${target} 里有什么`
  if (job?.tool === 'read') return `Amie 在读 ${target}`
  if (job?.tool === 'write') return `Amie 新建了 ${target}`
  return `Amie 请求了一个这个版本不认识的操作（${job?.tool}）`
}

const defaultSleep = (ms, signal) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
})

/**
 * 一直取任务，直到 signal 中止或令牌失效（失效时抛出，提示重新配对）。
 * 网络出错按 1s、2s、4s……最多 30s 退避重试。
 */
export async function runBridge({ server, token, folder, fetchImpl = fetch, log = console.log, signal, sleep = defaultSleep }) {
  const origin = normalizeServer(server)
  const headers = { Authorization: `Bridge ${token}` }
  let backoff = 1000
  while (!signal?.aborted) {
    try {
      const response = await fetchImpl(`${origin}/api/bridge/poll`, { headers, signal })
      if (response.status === 401) throw Object.assign(new Error('这台电脑的连接已失效，请在 Amie 的「设置 → 连接你的电脑」里重新生成连接码'), { fatal: true })
      if (response.status === 204) { backoff = 1000; continue }
      if (!response.ok) throw new Error(await errorMessage(response, `服务暂时不可用（${response.status}）`))
      const { job } = await response.json()
      backoff = 1000
      if (!job?.id) continue
      const outcome = await handleJob(folder, job)
      log(outcome.ok ? describeJob(job) : `${describeJob(job)}：没做成，${outcome.error}`)
      await fetchImpl(`${origin}/api/bridge/jobs/${encodeURIComponent(job.id)}/result`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(outcome),
        signal,
      })
    } catch (error) {
      if (signal?.aborted) break
      if (error.fatal) throw error
      log(`暂时连不上 Amie（${error.message}），${Math.round(backoff / 1000)} 秒后重试`)
      await sleep(backoff, signal)
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
    }
  }
}
