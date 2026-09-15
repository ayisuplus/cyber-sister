/**
 * 联网搜索服务：web_search 工具的执行体。
 *
 * 2026-09-12：DuckDuckGo HTML 端点在当前网络不可达（连接超时），切换为必应。
 * 抓取主通道改为 agent-browser CLI（`read --raw`，纯 HTTP 抓取面，不启动浏览器、
 * 不提供可导航/可点击的浏览面）；CLI 缺失或失败时回退一次直接 fetch。
 * 照仓库诚实不可用范式：SEARCH_ENABLED 未开启、双通道均失败一律如实 503，
 * 结果为空返回空数组，不伪造搜索结果；
 * 日志只记 userId、关键词长度与抓取通道，不记关键词正文与结果内容。
 */
import { execFile } from 'node:child_process'
import { HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'

const FETCH_TIMEOUT_MS = 15_000
const CLI_TIMEOUT_MS = 25_000
const CLI_MAX_BUFFER = 8 * 1024 * 1024
const MAX_RESULTS = 5
const MAX_QUERY_CHARS = 100
const MAX_TITLE_CHARS = 80
const MAX_SNIPPET_CHARS = 200
const SEARCH_ENDPOINT = 'https://www.bing.com/search'
const SEARCH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
// Windows：npm 全局 bin 是 .cmd shim，而 Node 安全更新后 execFile 禁裸跑 .cmd；
// 用 where.exe 找到 shim 再推回包里的原生 exe（agent-browser 是 Rust 二进制），
// 推不出才退回 .cmd + shell:true（参数不转义，URL 需手动加引号防 & 被 cmd 截断）。
import { existsSync } from 'node:fs'
import path from 'node:path'

const CLI_EXE_RELATIVE = path.join('node_modules', 'agent-browser', 'bin', 'agent-browser-win32-x64.exe')
let cliTargetPromise = null
function resolveCliTarget() {
  if (cliTargetPromise) return cliTargetPromise
  cliTargetPromise = new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ command: 'agent-browser', shell: false })
    execFile('where.exe', ['agent-browser'], { timeout: 5000, windowsHide: true }, (error, stdout) => {
      if (!error) {
        const shim = stdout.split(/\r?\n/).find((line) => line.trim().endsWith('.cmd'))
        if (shim) {
          const exe = path.join(path.dirname(shim.trim()), CLI_EXE_RELATIVE)
          if (existsSync(exe)) return resolve({ command: exe, shell: false })
        }
      }
      resolve({ command: 'agent-browser.cmd', shell: true })
    })
  })
  return cliTargetPromise
}

// 只取搜索结果区，排除页头/相关搜索/页脚里的 h2 链接
const RESULT_SCOPE_RE = /id="b_results"([\s\S]*?)(?:id="b_context"|id="b_footer"|$)/
const ITEM_RE = /<li class="b_algo"[\s\S]*?<\/li>/g
const TITLE_RE = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/
const SNIPPET_RE = /<p[^>]*>([\s\S]*?)<\/p>/

function clip(text, max) {
  const value = String(text ?? '')
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function stripTags(html) {
  return String(html ?? '').replace(/<[^>]+>/g, '')
}

function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;|&ensp;|&emsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/** 必应结果链接通常是直达地址；只保留 http(s)，丢弃 javascript: 等协议。 */
function realUrl(href) {
  try {
    const url = new URL(href)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.href
  } catch {
    return null
  }
}

export function parseResults(html) {
  const scope = RESULT_SCOPE_RE.exec(String(html ?? ''))
  const body = scope ? scope[1] : String(html ?? '')
  const results = []
  for (const item of body.matchAll(ITEM_RE)) {
    const titleMatch = TITLE_RE.exec(item[0])
    if (!titleMatch) continue
    const url = realUrl(decodeEntities(titleMatch[1]).trim())
    const title = decodeEntities(stripTags(titleMatch[2])).trim().replace(/\s+/g, ' ')
    if (!url || !title) continue
    const snippetMatch = SNIPPET_RE.exec(item[0])
    const snippet = snippetMatch
      ? decodeEntities(stripTags(snippetMatch[1])).trim().replace(/\s+/g, ' ')
      : ''
    results.push({ url, title: clip(title, MAX_TITLE_CHARS), snippet: clip(snippet, MAX_SNIPPET_CHARS) })
    if (results.length >= MAX_RESULTS) break
  }
  return results
}

export function isSearchEnabled(env = process.env) {
  return env.SEARCH_ENABLED === 'true'
}

function unavailable(message = '联网搜索暂不可用，请稍后重试') {
  const error = new HttpError(message, 503)
  error.code = 'SEARCH_UNAVAILABLE'
  return error
}

/** agent-browser 抓取通道：`read --raw` 是纯 HTTP 抓取（不启动 Chrome），返回页面原始 HTML。 */
async function assertSearchAuthorized({ signal, authorizeExternal } = {}) {
  signal?.throwIfAborted()
  if (authorizeExternal && await authorizeExternal() !== true) throw unavailable('云端授权已撤回')
  signal?.throwIfAborted()
}

async function fetchViaAgentBrowser(url, options) {
  const target = await resolveCliTarget()
  await assertSearchAuthorized(options)
  // shell:true 时参数不转义、直接拼接：URL 手动加双引号防 cmd 把 & 当命令分隔符。
  // 关键词已 encodeURIComponent，URL 内不可能出现引号，这里再兜底剥一次。
  const safeUrl = target.shell ? `"${url.replace(/"/g, '')}"` : url
  return new Promise((resolve, reject) => {
    execFile(
      target.command,
      ['read', safeUrl, '--raw'],
      { timeout: CLI_TIMEOUT_MS, maxBuffer: CLI_MAX_BUFFER, windowsHide: true, shell: target.shell, signal: options.signal },
      (error, stdout) => {
        if (error) return reject(error)
        resolve(stdout)
      },
    )
  })
}

async function fetchHtml(url, userId, options) {
  try {
    const html = await fetchViaAgentBrowser(url, options)
    options.signal?.throwIfAborted()
    if (html && html.length > 0) return html
    logger.warn('agent-browser 返回空页面，回退直接请求', { userId })
  } catch (error) {
    options.signal?.throwIfAborted()
    // execFile 的 message 包含完整命令与搜索 URL，只记录稳定错误码。
    logger.warn('agent-browser 抓取失败，回退直接请求', { userId, code: error.code || 'CLI_ERROR' })
  }

  let response
  await assertSearchAuthorized(options)
  try {
    response = await fetch(url, {
      headers: { 'user-agent': SEARCH_USER_AGENT, 'accept': 'text/html' },
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) : AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    options.signal?.throwIfAborted()
    throw unavailable()
  }
  if (!response.ok) throw unavailable()
  return response.text()
}

/**
 * 搜索一次并返回结构化结果：{ query, results: [{ title, url, snippet }] }。
 * 未启用抛 503 SEARCH_UNAVAILABLE；关键词为空抛 400。
 */
export async function searchWeb(userId, query, env = process.env, options = {}) {
  options.signal?.throwIfAborted()
  if (!isSearchEnabled(env)) throw new HttpError('联网搜索未启用', 503)
  const keyword = String(query ?? '').trim().slice(0, MAX_QUERY_CHARS)
  if (!keyword) throw new HttpError('搜索关键词不能为空', 400)
  logger.info('联网搜索', { userId, queryLength: keyword.length })

  const url = `${SEARCH_ENDPOINT}?q=${encodeURIComponent(keyword)}&setlang=zh-CN&mkt=zh-CN`
  const html = await fetchHtml(url, userId, options)
  options.signal?.throwIfAborted()
  return { query: keyword, results: parseResults(html) }
}
