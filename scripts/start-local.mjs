#!/usr/bin/env node
/**
 * 一键启动（本机开发 / 论文演示）：数据库 → 迁移 → 向量服务 → 语音转写 → 补算记忆向量 → API → 网页，最后打开浏览器。
 *
 *   pnpm start:local                    （或双击仓库根目录的 start-amie.cmd）
 *   pnpm start:local -- --no-open       不自动打开浏览器
 *
 * - 已经在跑的部分（健康检查通过）直接沿用，不重复起；Ctrl+C 只停这个脚本起的进程，数据库容器留着。
 * - 向量服务是产品的一部分：apps/api/.env 配了本机向量服务（MEMORY_EMBEDDING_BASE_URL 指向本机）却起不来，
 *   就整个不启动并说明原因，不让记忆检索和书架选章悄悄退回关键词。
 * - 语音转写可选：没装（tools/asr-server/.venv 不在）或没配 ASR_BASE_URL 就跳过，语音输入如实显示不可用。
 * - 读 apps/api/.env 只取地址、端口和密钥文件路径，不打印任何值。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const API_DIR = path.join(ROOT, 'apps', 'api')
// Vite 默认只听 localhost（Windows 上常是 IPv6 的 ::1），打开用 localhost，探活两个地址都试
const WEB_URL = 'http://localhost:5173'
const WEB_PROBES = ['http://[::1]:5173', 'http://127.0.0.1:5173']
const isWin = process.platform === 'win32'
const openBrowser = !process.argv.includes('--no-open')

const { parse } = createRequire(path.join(API_DIR, 'package.json'))('dotenv')
const env = existsSync(path.join(API_DIR, '.env')) ? parse(readFileSync(path.join(API_DIR, '.env'))) : {}

const children = []
const say = (message) => console.log(`[一键启动] ${message}`)
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })
const isLocalHost = (host) => ['127.0.0.1', 'localhost', '::1'].includes(host)

function fail(message) {
  console.error(`[一键启动] 没能启动：${message}`)
  stopAll(1)
}

async function httpJson(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
    return response.ok ? await response.json().catch(() => ({})) : null
  } catch {
    return null
  }
}

async function waitFor(check, { seconds, label }) {
  const deadline = Date.now() + seconds * 1000
  let noted = false
  for (;;) {
    const result = await check()
    if (result) return result
    if (Date.now() > deadline) return null
    if (!noted && label) { say(label); noted = true }
    await sleep(1500)
  }
}

// 子进程共用的环境：Python 不缓冲、按 UTF-8 输出；Prisma 不打升级横幅
const childEnv = (extra = {}) => ({ ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PRISMA_HIDE_UPDATE_MESSAGE: '1', ...extra })

/** pnpm 在 Windows 上是 .cmd，得经 shell 起；参数都是这里写死的，拼成一整条命令交给 shell。 */
const viaShell = (command, args) => (isWin ? [[command, ...args].join(' '), [], true] : [command, args, false])

/** 同步跑一条 pnpm 命令，输出直接给终端；失败返回 false。 */
function runPnpm(args) {
  const [command, rest, shell] = viaShell('pnpm', args)
  return spawnSync(command, rest, { cwd: ROOT, stdio: 'inherit', shell, env: childEnv() }).status === 0
}

/** 起一个常驻进程，输出每行加上前缀；这个脚本退出时一起停掉。 */
function start(name, command, args, { cwd = ROOT, extraEnv = {}, shell = false } = {}) {
  const child = spawn(command, args, { cwd, shell, windowsHide: true, env: childEnv(extraEnv), stdio: ['ignore', 'pipe', 'pipe'] })
  const prefix = (stream, out) => {
    let buffer = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop()
      for (const line of lines) if (line.trim()) out.write(`[${name}] ${line}\n`)
    })
  }
  prefix(child.stdout, process.stdout)
  prefix(child.stderr, process.stderr)
  child.on('exit', (code) => {
    if (!stopping) console.error(`[一键启动] ${name} 退出了（${code ?? '被结束'}）`)
  })
  children.push({ name, child })
  return child
}

/** 常驻的 pnpm 进程（API、网页）。 */
function startPnpm(name, args) {
  const [command, rest, shell] = viaShell('pnpm', args)
  return start(name, command, rest, { shell })
}

let stopping = false
function stopAll(code = 0) {
  if (stopping) return
  stopping = true
  for (const { name, child } of children.reverse()) {
    if (child.exitCode !== null) continue
    if (isWin) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill('SIGTERM')
    say(`已停下 ${name}`)
  }
  process.exit(code)
}
// Ctrl+C 是 SIGINT；Windows 上直接点窗口右上角关掉是 SIGHUP。被强行结束时来不及收拾，
// 留下的服务下次一键启动会按健康检查沿用，不会端口冲突
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => stopAll(0))

const venvPython = (dir) => path.join(dir, '.venv', isWin ? 'Scripts/python.exe' : 'bin/python')
const secretPath = (value) => (value ? path.resolve(API_DIR, value) : null)

// ---------- 1. 数据库（compose.dev.yaml 里的 PostgreSQL） ----------
async function startDatabase() {
  const host = env.DATABASE_HOST || (env.DATABASE_URL ? new URL(env.DATABASE_URL).hostname : '')
  if (!isLocalHost(host)) {
    say('数据库不在本机，跳过 Docker')
    return
  }
  const dockerUp = () => spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0
  if (!dockerUp()) {
    const desktop = 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe'
    if (isWin && existsSync(desktop)) spawn(desktop, [], { detached: true, stdio: 'ignore' }).unref()
    if (!await waitFor(dockerUp, { seconds: 180, label: '等 Docker 启动……' })) fail('Docker 没起来，先手动打开 Docker Desktop')
  }
  if (spawnSync('docker', ['compose', '-f', 'compose.dev.yaml', 'up', '-d'], { cwd: ROOT, stdio: 'inherit' }).status !== 0) fail('数据库容器起不来')
  const id = spawnSync('docker', ['compose', '-f', 'compose.dev.yaml', 'ps', '-q', 'postgres'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim()
  const healthy = () => spawnSync('docker', ['inspect', '-f', '{{.State.Health.Status}}', id], { encoding: 'utf8' }).stdout.trim() === 'healthy'
  if (!await waitFor(healthy, { seconds: 90, label: '等数据库就绪……' })) fail('数据库容器一直没就绪')
  say('数据库就绪')
}

// ---------- 2. 迁移（只用 migrate deploy） ----------
function migrate() {
  if (!runPnpm(['--filter', 'cyber-sister-server', 'run', 'db:migrate:deploy'])) fail('数据库迁移失败，见上面的输出')
}

// ---------- 3. 本机向量服务（记忆检索与书架选章） ----------
async function startEmbedding() {
  const base = env.MEMORY_EMBEDDING_BASE_URL
  if (!base || !env.MEMORY_EMBEDDING_MODEL) {
    say('没配置向量模型（MEMORY_EMBEDDING_*）：记忆与书架选章只看关键词')
    return
  }
  const url = new URL(base)
  if (!isLocalHost(url.hostname)) {
    say('向量模型用的是云端供应商，不用在本机起服务')
    return
  }
  const healthUrl = `${url.origin}/health`
  const matches = (health) => health && health.model === env.MEMORY_EMBEDDING_MODEL && String(health.dimensions) === String(env.MEMORY_EMBEDDING_DIMENSIONS)
  const running = await httpJson(healthUrl)
  if (running) {
    if (!matches(running)) fail(`${url.host} 上已经有一个向量服务，但模型是 ${running.model}（${running.dimensions} 维），和 .env 里的对不上`)
    say(`向量服务已经在跑（${running.model}），沿用`)
    return
  }
  const dir = path.join(ROOT, 'tools', 'embedding-server')
  const tokenFile = secretPath(env.MEMORY_EMBEDDING_API_KEY_FILE)
  if (!existsSync(venvPython(dir))) fail('向量服务还没装：在 tools/embedding-server 里按 server.py 文首建 .venv 并装 requirements.txt')
  if (!tokenFile || !existsSync(tokenFile)) fail('找不到向量服务的令牌文件（MEMORY_EMBEDDING_API_KEY_FILE）')
  start('向量', venvPython(dir), ['server.py'], {
    cwd: dir,
    extraEnv: { EMBEDDING_API_KEY_FILE: tokenFile, EMBEDDING_MODEL_ID: env.MEMORY_EMBEDDING_MODEL, EMBEDDING_PORT: url.port || '80' },
  })
  const health = await waitFor(() => httpJson(healthUrl), { seconds: 240, label: '等向量模型加载……（首次会从 ModelScope 下载）' })
  if (!health) fail('向量服务没起来，见上面 [向量] 的输出')
  if (!matches(health)) fail(`向量服务的模型是 ${health.model}（${health.dimensions} 维），和 .env 里的对不上`)
  say(`向量服务就绪（${health.model}，${health.dimensions} 维）`)
}

// ---------- 4. 语音转写（可选） ----------
async function startAsr() {
  const base = env.ASR_BASE_URL
  const dir = path.join(ROOT, 'tools', 'asr-server')
  if (!base) return say('没配 ASR_BASE_URL：语音输入不开放')
  const url = new URL(base)
  if (!isLocalHost(url.hostname)) return undefined
  if (await httpJson(`${url.origin}/health`)) return say('语音转写已经在跑，沿用')
  if (!existsSync(venvPython(dir))) return say('语音转写没装（tools/asr-server/.venv 不在）：语音输入会显示不可用')
  start('语音', venvPython(dir), ['server.py'], { cwd: dir, extraEnv: { ASR_PORT: url.port || '80' } })
  // 模型大，加载慢：不挡着别的，就绪了 API 自然能用上
  void waitFor(() => httpJson(`${url.origin}/health`), { seconds: 300 })
    .then((health) => say(health ? '语音转写就绪' : '语音转写 5 分钟还没就绪，见上面 [语音] 的输出'))
  return undefined
}

// ---------- 5. 补算记忆向量（只补缺的，没同意的用户不动） ----------
function reindexMemories() {
  if (!env.MEMORY_EMBEDDING_BASE_URL) return
  if (!runPnpm(['--filter', 'cyber-sister-server', 'run', 'memories:reindex'])) say('有记忆没补算成，见上面的输出（不影响启动）')
}

// ---------- 6. API 与网页 ----------
async function startApi() {
  const port = env.PORT || '3000'
  const readyUrl = `http://127.0.0.1:${port}/api/health/ready`
  if (await httpJson(readyUrl)) {
    say(`API 已经在跑（:${port}），沿用。刚改过 .env 的话，让它重启一次才读得到`)
    return
  }
  startPnpm('API', ['--filter', 'cyber-sister-server', 'dev'])
  if (!await waitFor(() => httpJson(readyUrl), { seconds: 120, label: '等 API 就绪……' })) fail('API 没起来，见上面 [API] 的输出')
  say(`API 就绪（:${port}）`)
}

async function startWeb() {
  const reachable = (url) => fetch(url, { signal: AbortSignal.timeout(2000) }).then((response) => response.ok).catch(() => false)
  const up = async () => (await Promise.all(WEB_PROBES.map(reachable))).some(Boolean)
  if (await up()) return say('网页已经在跑，沿用')
  startPnpm('网页', ['--filter', 'cyber-sister-client', 'dev'])
  if (!await waitFor(up, { seconds: 90, label: '等网页就绪……' })) fail('网页没起来，见上面 [网页] 的输出')
  return say('网页就绪')
}

await startDatabase()
migrate()
await startEmbedding()
await startAsr()
reindexMemories()
await startApi()
await startWeb()
say(`都起来了：${WEB_URL}`)
if (openBrowser) {
  if (isWin) spawn('cmd', ['/c', 'start', '', WEB_URL], { detached: true, stdio: 'ignore' }).unref()
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [WEB_URL], { detached: true, stdio: 'ignore' }).unref()
}
if (children.length) say('这个窗口别关；按 Ctrl+C 停下这次起的服务（数据库容器留着）')
else process.exit(0)
