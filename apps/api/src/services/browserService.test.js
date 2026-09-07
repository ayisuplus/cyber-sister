import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pw = vi.hoisted(() => {
  const element = {
    isVisible: vi.fn(),
    evaluate: vi.fn(),
    click: vi.fn(),
    fill: vi.fn(),
  }
  const page = {
    goto: vi.fn(),
    $$: vi.fn(),
    innerText: vi.fn(),
    title: vi.fn(),
    url: vi.fn(),
    isClosed: vi.fn(),
    waitForLoadState: vi.fn(),
    waitForSelector: vi.fn(),
    $$eval: vi.fn(),
  }
  const context = { newPage: vi.fn(), close: vi.fn() }
  const browser = { newContext: vi.fn(), close: vi.fn() }
  return { element, page, context, browser, launch: vi.fn() }
})

vi.mock('playwright-core', () => ({ chromium: { launch: pw.launch } }))
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  openPage,
  readPage,
  clickRef,
  typeIntoRef,
  closeSession,
  closeBrowser,
  getBrowserStatus,
  searchWeb,
} from './browserService.js'

describe('browserService', () => {
  beforeEach(() => {
    process.env.BROWSER_ENABLED = 'true'
    process.env.SEARCH_ENABLED = 'true'
    delete process.env.BROWSER_HEADED
    delete process.env.BROWSER_CHROMIUM_PATH
    vi.clearAllMocks()
    pw.launch.mockResolvedValue(pw.browser)
    pw.browser.newContext.mockResolvedValue(pw.context)
    pw.context.newPage.mockResolvedValue(pw.page)
    pw.page.isClosed.mockReturnValue(false)
    pw.page.url.mockReturnValue('https://example.com/')
    pw.page.title.mockResolvedValue('示例标题')
    pw.page.innerText.mockResolvedValue('正文内容')
    pw.page.$$.mockResolvedValue([pw.element])
    pw.page.waitForLoadState.mockResolvedValue(undefined)
    pw.page.waitForSelector.mockResolvedValue(null)
    pw.page.$$eval.mockResolvedValue([])
    pw.element.isVisible.mockResolvedValue(true)
    pw.element.evaluate.mockResolvedValue({ role: 'a', label: '链接' })
  })

  afterEach(async () => {
    await closeBrowser()
    delete process.env.BROWSER_ENABLED
    delete process.env.SEARCH_ENABLED
  })

  it('BROWSER_ENABLED 未开启时所有动作抛 503，状态接口如实报告', async () => {
    delete process.env.BROWSER_ENABLED

    await expect(openPage('u1', 'https://example.com')).rejects.toMatchObject({ statusCode: 503, message: '内置浏览器未启用' })
    await expect(readPage('u1')).rejects.toMatchObject({ statusCode: 503 })
    expect(getBrowserStatus()).toMatchObject({ enabled: false, running: false })
  })

  it('只允许 http/https 网址，其余 400 且不启动浏览器', async () => {
    await expect(openPage('u1', 'file:///C:/Windows')).rejects.toMatchObject({ statusCode: 400, message: '只允许 http/https 网址' })
    await expect(openPage('u1', 'not-a-url')).rejects.toMatchObject({ statusCode: 400 })
    expect(pw.launch).not.toHaveBeenCalled()
  })

  it('openPage 返回标题/摘要/元素编号，非 production 默认弹可见窗口', async () => {
    const snapshot = await openPage('u1', 'https://example.com')

    expect(pw.launch).toHaveBeenCalledWith(expect.objectContaining({
      headless: false,
      args: expect.arrayContaining(['--no-sandbox', '--disable-dev-shm-usage']),
    }))
    expect(pw.page.goto).toHaveBeenCalledWith('https://example.com', expect.objectContaining({ timeout: 20000 }))
    expect(snapshot).toMatchObject({
      url: 'https://example.com/',
      title: '示例标题',
      excerpt: '正文内容',
      refs: [{ ref: 'e1', role: 'a', label: '链接' }],
    })
    expect(getBrowserStatus()).toMatchObject({ enabled: true, running: true, headed: true })
  })

  it('clickRef/typeIntoRef 命中上次快照元素；未知引用 400 过期', async () => {
    await openPage('u1', 'https://example.com')

    const afterClick = await clickRef('u1', 'e1')
    expect(pw.element.click).toHaveBeenCalledWith({ timeout: 10000 })
    expect(afterClick.refs).toHaveLength(1)

    await typeIntoRef('u1', 'e1', '你好')
    expect(pw.element.fill).toHaveBeenCalledWith('你好', { timeout: 10000 })

    await expect(clickRef('u1', 'e99')).rejects.toMatchObject({ statusCode: 400, message: '元素引用已过期，请重新读取页面' })
  })

  it('正文摘要截断到 1200 字符，标签截断到 40 字符', async () => {
    pw.page.innerText.mockResolvedValue('x'.repeat(2000))
    pw.element.evaluate.mockResolvedValue({ role: 'button', label: '长'.repeat(80) })

    const snapshot = await openPage('u1', 'https://example.com')

    expect(snapshot.excerpt).toHaveLength(1201)
    expect(snapshot.refs[0].label).toHaveLength(41)
  })

  it('同一用户复用同一页面，closeSession 关闭上下文', async () => {
    await openPage('u1', 'https://example.com')
    await openPage('u1', 'https://example.com/two')

    expect(pw.context.newPage).toHaveBeenCalledTimes(1)
    expect(pw.page.goto).toHaveBeenCalledTimes(2)

    await closeSession('u1')
    expect(pw.context.close).toHaveBeenCalledTimes(1)
  })

  it('closeBrowser 回收全部会话与浏览器进程', async () => {
    await openPage('u1', 'https://example.com')

    await closeBrowser()

    expect(pw.context.close).toHaveBeenCalledTimes(1)
    expect(pw.browser.close).toHaveBeenCalledTimes(1)
    expect(getBrowserStatus().running).toBe(false)
  })

  it('SEARCH_ENABLED 未开启时搜索抛 503', async () => {
    delete process.env.SEARCH_ENABLED

    await expect(searchWeb('u1', 'x')).rejects.toMatchObject({ statusCode: 503, message: '联网搜索未启用' })
    expect(pw.launch).not.toHaveBeenCalled()
  })

  it('搜索关键词为空抛 400 且不启动浏览器', async () => {
    await expect(searchWeb('u1', '  ')).rejects.toMatchObject({ statusCode: 400, message: '搜索关键词不能为空' })
    await expect(searchWeb('u1', undefined)).rejects.toMatchObject({ statusCode: 400, message: '搜索关键词不能为空' })
    expect(pw.launch).not.toHaveBeenCalled()
  })

  it('searchWeb 解析结构化结果并按长度截断，上下文用后关闭', async () => {
    // 用假 DOM 节点跑真实映射回调：覆盖锚点/摘要缺失、空标题过滤等分支
    const makeNode = (anchor, caption) => ({
      querySelector: (selector) => (selector === 'h2 a' ? anchor : caption),
    })
    pw.page.$$eval.mockImplementation((_selector, fn) => fn([
      makeNode({ innerText: '标'.repeat(100), href: 'https://a.example/1' }, { innerText: '摘'.repeat(300) }),
      makeNode({ innerText: '短标题', href: 'https://a.example/2' }, null),
      makeNode(null, { innerText: '无标题条目' }),
      makeNode({ innerText: '', href: '' }, null),
    ]))

    const result = await searchWeb('u1', '本周新闻')

    expect(pw.page.goto).toHaveBeenCalledWith(
      `https://cn.bing.com/search?q=${encodeURIComponent('本周新闻')}`,
      expect.objectContaining({ waitUntil: 'domcontentloaded' }),
    )
    expect(result.query).toBe('本周新闻')
    expect(result.results).toEqual([
      { title: `${'标'.repeat(80)}…`, url: 'https://a.example/1', snippet: `${'摘'.repeat(200)}…` },
      { title: '短标题', url: 'https://a.example/2', snippet: '' },
    ])
    expect(pw.context.close).toHaveBeenCalledTimes(1)
  })

  it('结果列表等待超时返回空结果而不抛错', async () => {
    pw.page.waitForSelector.mockRejectedValue(new Error('Timeout 5000ms exceeded'))

    const result = await searchWeb('u1', '冷门词')

    expect(result).toEqual({ query: '冷门词', results: [] })
    expect(pw.context.close).toHaveBeenCalledTimes(1)
  })

  it('导航失败时错误上抛且上下文仍关闭', async () => {
    pw.page.goto.mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'))

    await expect(searchWeb('u1', 'x')).rejects.toThrow('net::ERR_CONNECTION_REFUSED')
    expect(pw.context.close).toHaveBeenCalledTimes(1)
  })
})
