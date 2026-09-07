/**
 * 内置浏览器服务（工作模式 browser_* 工具的执行体）。
 *
 * 通过 playwright-core 驱动本机 Chromium；dev 主机默认弹可见窗口（用户可看 agent 操作），
 * 容器/production 强制无头。懒加载单例 browser，每用户一个 BrowserContext 与当前页。
 *
 * 安全边界：
 * - 仅当 BROWSER_ENABLED='true' 时可用，否则一律 503。
 * - URL 只允许 http/https，拒绝 file:// 等本机 scheme。
 * - 日志只记 action/userId/host，绝不记录 URL 全文、页面内容或输入文本。
 */
import { chromium } from 'playwright-core'
import { HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'

const NAVIGATION_TIMEOUT_MS = 20_000
const ACTION_TIMEOUT_MS = 10_000
const MAX_SNAPSHOT_REFS = 50
const MAX_LABEL_LENGTH = 40
const MAX_EXCERPT_LENGTH = 1200
const IDLE_SWEEP_INTERVAL_MS = 60_000
const IDLE_TIMEOUT_MS = 10 * 60_000
const SNAPSHOT_SELECTOR = 'a, button, input, textarea, select, [role="button"], [role="link"]'
const SEARCH_URL = 'https://cn.bing.com/search?q='
const MAX_SEARCH_RESULTS = 5
const MAX_SEARCH_TITLE_LENGTH = 80
const MAX_SEARCH_SNIPPET_LENGTH = 200
const SEARCH_RESULT_WAIT_MS = 5_000
// 无头 UA 会被搜索引擎按机器人拦截/跳验证页，搜索上下文使用普通桌面 UA
const SEARCH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const isEnabled = () => process.env.BROWSER_ENABLED === 'true'

const isHeaded = () => (process.env.BROWSER_HEADED !== undefined
  ? process.env.BROWSER_HEADED === 'true'
  : process.env.NODE_ENV !== 'production')

const isSearchEnabled = () => process.env.SEARCH_ENABLED === 'true'

const resolveExecutablePath = () => process.env.BROWSER_CHROMIUM_PATH
  || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  || undefined

function assertEnabled() {
  if (!isEnabled()) throw new HttpError('内置浏览器未启用', 503)
}

function assertHttpUrl(url) {
  let parsed
  try {
    parsed = new URL(String(url ?? ''))
  } catch {
    throw new HttpError('只允许 http/https 网址', 400)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpError('只允许 http/https 网址', 400)
  }
  return parsed
}

function clipText(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

let browserPromise = null
/** @type {Map<string, { context: object, page: object|null, refs: Map<string, object>, lastUsedAt: number }>} */
const sessions = new Map()

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      executablePath: resolveExecutablePath(),
      headless: !isHeaded(),
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    browserPromise.catch(() => {
      // 启动失败（如未安装浏览器）：清掉缓存，下次重试，状态接口如实报未运行
      browserPromise = null
    })
  }
  return browserPromise
}

async function getSession(userId) {
  const existing = sessions.get(userId)
  if (existing) {
    existing.lastUsedAt = Date.now()
    return existing
  }
  const browser = await getBrowser()
  const context = await browser.newContext()
  const session = { context, page: null, refs: new Map(), lastUsedAt: Date.now() }
  sessions.set(userId, session)
  return session
}

async function getCurrentPage(session) {
  if (session.page && !session.page.isClosed()) return session.page
  session.refs = new Map()
  session.page = await session.context.newPage()
  return session.page
}

/** 页面快照：可见可操作元素编号 e1..eN（refs 映射随每次快照整体重建，导航后旧引用自然失效）。 */
async function snapshotPage(page, session) {
  const handles = await page.$$(SNAPSHOT_SELECTOR)
  const refs = []
  const nextRefs = new Map()
  for (const handle of handles) {
    if (refs.length >= MAX_SNAPSHOT_REFS) break
    try {
      // 快照枚举期间元素可能被页面脚本移除：逐项容错跳过
      // eslint-disable-next-line no-await-in-loop
      if (!(await handle.isVisible())) continue
      // eslint-disable-next-line no-await-in-loop
      const meta = await handle.evaluate((el) => ({
        role: el.getAttribute('role') || el.tagName.toLowerCase(),
        label: el.innerText
          || el.getAttribute('aria-label')
          || el.getAttribute('placeholder')
          || el.getAttribute('value')
          || '',
      }))
      const ref = `e${refs.length + 1}`
      nextRefs.set(ref, handle)
      refs.push({ ref, role: meta.role, label: clipText(meta.label, MAX_LABEL_LENGTH) })
    } catch {
      // 元素在枚举途中脱离文档：跳过
    }
  }
  session.refs = nextRefs

  let excerpt = ''
  try {
    excerpt = clipText(await page.innerText('body'), MAX_EXCERPT_LENGTH)
  } catch {
    // 页面正在导航等场景取不到正文：返回空摘要
  }
  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    excerpt,
    refs,
  }
}

function logAction(action, userId, host) {
  logger.info('内置浏览器动作', { action, userId, host })
}

function pageHost(page) {
  try {
    return new URL(page.url()).host || undefined
  } catch {
    return undefined
  }
}

export async function openPage(userId, url) {
  assertEnabled()
  const { host } = assertHttpUrl(url)
  const session = await getSession(userId)
  const page = await getCurrentPage(session)
  await page.goto(String(url), { timeout: NAVIGATION_TIMEOUT_MS, waitUntil: 'domcontentloaded' })
  logAction('open', userId, host)
  return snapshotPage(page, session)
}

export async function readPage(userId) {
  assertEnabled()
  const session = await getSession(userId)
  const page = await getCurrentPage(session)
  logAction('read', userId, pageHost(page))
  return snapshotPage(page, session)
}

/** 联网搜索：一次性无头上下文开 Bing 结果页，解析前 5 条结构化结果；不占用每用户浏览会话。 */
export async function searchWeb(userId, query) {
  if (!isSearchEnabled()) throw new HttpError('联网搜索未启用', 503)
  const keyword = String(query ?? '').trim().slice(0, 100)
  if (!keyword) throw new HttpError('搜索关键词不能为空', 400)
  logger.info('联网搜索', { userId, queryLength: keyword.length })
  const browser = await getBrowser()
  const context = await browser.newContext({ locale: 'zh-CN', userAgent: SEARCH_USER_AGENT })
  try {
    const page = await context.newPage()
    await page.goto(`${SEARCH_URL}${encodeURIComponent(keyword)}`, {
      timeout: NAVIGATION_TIMEOUT_MS,
      waitUntil: 'domcontentloaded',
    })
    await page.waitForSelector('li.b_algo', { timeout: SEARCH_RESULT_WAIT_MS }).catch(() => null)
    const results = await page.$$eval('li.b_algo', (nodes) => nodes.slice(0, 5).map((node) => {
      const anchor = node.querySelector('h2 a')
      const caption = node.querySelector('.b_caption p')
      return {
        title: anchor?.innerText ?? '',
        url: anchor?.href ?? '',
        snippet: caption?.innerText ?? '',
      }
    }).filter((item) => item.title && item.url))
    return {
      query: keyword,
      results: results.slice(0, MAX_SEARCH_RESULTS).map((item) => ({
        title: clipText(item.title, MAX_SEARCH_TITLE_LENGTH),
        url: item.url,
        snippet: clipText(item.snippet, MAX_SEARCH_SNIPPET_LENGTH),
      })),
    }
  } finally {
    await context.close()
  }
}

function resolveRef(session, ref) {
  const handle = session.refs.get(String(ref ?? ''))
  if (!handle) throw new HttpError('元素引用已过期，请重新读取页面', 400)
  return handle
}

async function runRefAction(userId, ref, actionName, perform) {
  assertEnabled()
  const session = await getSession(userId)
  const page = await getCurrentPage(session)
  const handle = resolveRef(session, ref)
  try {
    await perform(handle)
  } catch (error) {
    if (String(error?.message || '').includes('not attached')) {
      throw new HttpError('元素引用已过期，请重新读取页面', 400)
    }
    throw error
  }
  // 点击/输入可能触发导航：等待 domcontentloaded，超时或异常都忽略后再重快照
  await page.waitForLoadState('domcontentloaded', { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {})
  logAction(actionName, userId, pageHost(page))
  return snapshotPage(page, session)
}

export function clickRef(userId, ref) {
  return runRefAction(userId, ref, 'click', (handle) => handle.click({ timeout: ACTION_TIMEOUT_MS }))
}

export function typeIntoRef(userId, ref, text) {
  return runRefAction(userId, ref, 'type', (handle) => handle.fill(String(text ?? ''), { timeout: ACTION_TIMEOUT_MS }))
}

export async function closeSession(userId) {
  const session = sessions.get(userId)
  if (!session) return
  sessions.delete(userId)
  try {
    await session.context.close()
  } catch {
    // 上下文可能已随浏览器断开：关闭路径不抛错
  }
  logAction('close', userId)
}

/** 进程关停钩子：关闭全部会话与浏览器本体，避免孤儿 chromium 进程。 */
export async function closeBrowser() {
  const sessionList = [...sessions.keys()]
  for (const userId of sessionList) {
    // 串行关闭，单个失败不阻塞其余会话回收
    // eslint-disable-next-line no-await-in-loop
    await closeSession(userId)
  }
  if (browserPromise) {
    const pending = browserPromise
    browserPromise = null
    try {
      const browser = await pending
      await browser.close()
    } catch {
      // 启动即失败或已断开：忽略
    }
  }
}

const idleSweeper = setInterval(() => {
  const now = Date.now()
  for (const [userId, session] of sessions) {
    if (now - session.lastUsedAt > IDLE_TIMEOUT_MS) {
      closeSession(userId).catch(() => {})
    }
  }
}, IDLE_SWEEP_INTERVAL_MS)
idleSweeper.unref()

export function getBrowserStatus() {
  return {
    enabled: isEnabled(),
    running: browserPromise !== null,
    headed: isHeaded(),
  }
}
