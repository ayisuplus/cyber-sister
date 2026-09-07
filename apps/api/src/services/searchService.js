/**
 * 联网搜索服务：web_search 工具的执行体。
 *
 * 云端切割（2026-09-07）：取代旧 browserService 用内置 Chromium 抓取搜索结果页的实现。
 * 新实现只做一次普通 HTTP 请求（DuckDuckGo HTML 端点），不启动任何浏览器进程，
 * 不提供用户可控的网页导航/点击/输入能力，服务端不再持有可被提示注入驱动的浏览面。
 * 照仓库诚实不可用范式：SEARCH_ENABLED 未开启、网络异常或解析为空一律如实失败，
 * 不伪造搜索结果；日志只记 userId 与关键词长度，不记关键词正文与结果内容。
 */
import { HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'

const SEARCH_TIMEOUT_MS = 15_000
const MAX_RESULTS = 5
const MAX_QUERY_CHARS = 100
const MAX_TITLE_CHARS = 80
const MAX_SNIPPET_CHARS = 200
const SEARCH_ENDPOINT = 'https://html.duckduckgo.com/html/'
const SEARCH_USER_AGENT = 'Mozilla/5.0 (compatible; cyber-sister/1.0)'

const TITLE_RE = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
const SNIPPET_RE = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g

function clip(text, max) {
  const value = String(text ?? '')
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function stripTags(html) {
  return String(html ?? '').replace(/<[^>]+>/g, '')
}

function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/** DuckDuckGo 的结果链接是跳转包装（uddg 参数携带真实地址），解出真实 URL。 */
function realUrl(href) {
  try {
    const url = new URL(href, SEARCH_ENDPOINT)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.searchParams.get('uddg') || url.href
  } catch {
    return null
  }
}

function parseResults(html) {
  const titles = []
  for (const match of html.matchAll(TITLE_RE)) {
    const url = realUrl(decodeEntities(match[1]))
    const title = decodeEntities(stripTags(match[2])).trim()
    if (url && title) titles.push({ url, title: clip(title, MAX_TITLE_CHARS) })
  }
  const snippets = []
  for (const match of html.matchAll(SNIPPET_RE)) {
    snippets.push(clip(decodeEntities(stripTags(match[1])).trim(), MAX_SNIPPET_CHARS))
  }
  return titles.slice(0, MAX_RESULTS).map((item, index) => ({
    ...item,
    snippet: snippets[index] ?? '',
  }))
}

export function isSearchEnabled(env = process.env) {
  return env.SEARCH_ENABLED === 'true'
}

function unavailable(message = '联网搜索暂不可用，请稍后重试') {
  const error = new HttpError(message, 503)
  error.code = 'SEARCH_UNAVAILABLE'
  return error
}

/**
 * 搜索一次并返回结构化结果：{ query, results: [{ title, url, snippet }] }。
 * 未启用抛 503 SEARCH_UNAVAILABLE；关键词为空抛 400。
 */
export async function searchWeb(userId, query, env = process.env) {
  if (!isSearchEnabled(env)) throw new HttpError('联网搜索未启用', 503)
  const keyword = String(query ?? '').trim().slice(0, MAX_QUERY_CHARS)
  if (!keyword) throw new HttpError('搜索关键词不能为空', 400)
  logger.info('联网搜索', { userId, queryLength: keyword.length })

  let response
  try {
    response = await fetch(`${SEARCH_ENDPOINT}?q=${encodeURIComponent(keyword)}`, {
      headers: { 'user-agent': SEARCH_USER_AGENT, 'accept': 'text/html' },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    })
  } catch {
    throw unavailable()
  }
  if (!response.ok) throw unavailable()
  const html = await response.text()
  return { query: keyword, results: parseResults(html) }
}
