import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

import { execFile } from 'node:child_process'
import { isSearchEnabled, parseResults, searchWeb } from './searchService.js'
import logger from '../utils/logger.js'

const BING_HTML = `
<html><body><ol id="b_results">
  <li class="b_algo">
    <h2><a href="https://zhihu.example/article"><strong>真实标题</strong> &amp; 副标题</a></h2>
    <p>2026年9月&ensp;&#0183;&ensp;摘要一 &lt;em&gt;高亮&lt;/em&gt; 正文</p>
  </li>
  <li class="b_algo">
    <h2><a href="https://direct.example/news">直达标题</a></h2>
    <p>摘要二</p>
  </li>
  <li class="b_algo">
    <h2><a href="javascript:void(0)">非法链接应被丢弃</a></h2>
  </li>
</ol><div id="b_context"><h2><a href="https://related.example">相关搜索不应入选</a></h2></div></body></html>
`

function mockCliSuccess(html) {
  execFile.mockImplementation((cmd, args, opts, cb) => cb(null, html, ''))
}

function mockCliFailure(error = new Error('spawn agent-browser.cmd ENOENT')) {
  execFile.mockImplementation((cmd, args, opts, cb) => cb(error))
}

// 联网搜索的诚实降级契约：未启用/双通道均失败一律 503，空关键词 400；
// 主通道 agent-browser（read --raw），失败回退直接 fetch，结果解析走必应 b_algo 形态。
describe('searchService', () => {
  it('取消后禁止搜索回退，撤回授权后下一次网络调用为零', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', vi.fn())
    execFile.mockClear()
    await expect(searchWeb('u1', 'x', { SEARCH_ENABLED: 'true' }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(execFile).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    mockCliFailure()
    const authorizeExternal = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false)
    await expect(searchWeb('u1', 'x', { SEARCH_ENABLED: 'true' }, { authorizeExternal })).rejects.toMatchObject({ code: 'SEARCH_UNAVAILABLE' })
    expect(fetch).not.toHaveBeenCalled()
  })
  beforeEach(() => {
    delete process.env.SEARCH_ENABLED
    vi.restoreAllMocks()
  })

  it('SEARCH_ENABLED 未开启时抛 503 联网搜索未启用', async () => {
    await expect(searchWeb('u1', 'x')).rejects.toMatchObject({
      statusCode: 503,
      message: '联网搜索未启用',
    })
    expect(isSearchEnabled()).toBe(false)
  })

  it('关键词为空或纯空白时抛 400', async () => {
    process.env.SEARCH_ENABLED = 'true'
    await expect(searchWeb('u1', '   ')).rejects.toMatchObject({
      statusCode: 400,
      message: '搜索关键词不能为空',
    })
    await expect(searchWeb('u1', undefined)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('主通道 agent-browser：解析必应结果、去标签、解码数字实体、丢弃非法协议', async () => {
    process.env.SEARCH_ENABLED = 'true'
    mockCliSuccess(BING_HTML)

    const result = await searchWeb('u1', '测试关键词')

    expect(execFile).toHaveBeenCalledWith(
      expect.stringContaining('agent-browser'),
      ['read', expect.stringContaining('q=%E6%B5%8B%E8%AF%95%E5%85%B3%E9%94%AE%E8%AF%8D'), '--raw'],
      expect.objectContaining({ timeout: expect.any(Number) }),
      expect.any(Function),
    )
    expect(result.query).toBe('测试关键词')
    expect(result.results).toEqual([
      { url: 'https://zhihu.example/article', title: '真实标题 & 副标题', snippet: '2026年9月 · 摘要一 <em>高亮</em> 正文' },
      { url: 'https://direct.example/news', title: '直达标题', snippet: '摘要二' },
    ])
  })

  it('agent-browser 失败时回退直接 fetch', async () => {
    process.env.SEARCH_ENABLED = 'true'
    mockCliFailure()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => BING_HTML })))

    const result = await searchWeb('u1', '周末去哪玩')

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('bing.com/search'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(result.results).toHaveLength(2)
  })

  it('agent-browser 返回空页面时也回退直接 fetch', async () => {
    process.env.SEARCH_ENABLED = 'true'
    mockCliSuccess('')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => BING_HTML })))

    const result = await searchWeb('u1', 'x')
    expect(result.results).toHaveLength(2)
  })

  it('CLI 失败日志不泄露命令、搜索 URL 或关键词', async () => {
    process.env.SEARCH_ENABLED = 'true'
    const keyword = 'synthetic-private-query'
    mockCliFailure(Object.assign(new Error(`Command failed: agent-browser read https://www.bing.com/search?q=${keyword}`), { code: 'ENOENT' }))
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => BING_HTML })))

    await searchWeb('u1', keyword)

    expect(logger.warn).toHaveBeenCalledWith('agent-browser 抓取失败，回退直接请求', { userId: 'u1', code: 'ENOENT' })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(keyword)
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('bing.com/search')
  })

  it('双通道均失败时抛 503 SEARCH_UNAVAILABLE', async () => {
    process.env.SEARCH_ENABLED = 'true'
    mockCliFailure()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    await expect(searchWeb('u1', 'x')).rejects.toMatchObject({
      statusCode: 503,
      code: 'SEARCH_UNAVAILABLE',
    })
  })

  it('fetch 上游非 2xx 时抛 503 SEARCH_UNAVAILABLE', async () => {
    process.env.SEARCH_ENABLED = 'true'
    mockCliFailure()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => '' })))
    await expect(searchWeb('u1', 'x')).rejects.toMatchObject({ statusCode: 503 })
  })

  it('结果为空时返回空数组而不是报错', async () => {
    process.env.SEARCH_ENABLED = 'true'
    mockCliSuccess('<html><body><ol id="b_results"></ol></body></html>')
    const result = await searchWeb('u1', '冷门词')
    expect(result).toEqual({ query: '冷门词', results: [] })
  })

  it('关键词超长时截断到 100 字符', async () => {
    process.env.SEARCH_ENABLED = 'true'
    mockCliSuccess('')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '' })))
    const longQuery = '长'.repeat(150)
    const result = await searchWeb('u1', longQuery)
    expect(result.query).toHaveLength(100)
  })

  it('parseResults 截取标题 80 字符、摘要 200 字符', () => {
    const longTitle = '标'.repeat(100)
    const longSnippet = '摘'.repeat(250)
    const html = `<ol id="b_results"><li class="b_algo"><h2><a href="https://a.example">${longTitle}</a></h2><p>${longSnippet}</p></li></ol>`
    const [item] = parseResults(html)
    expect(item.title).toHaveLength(81)
    expect(item.snippet).toHaveLength(201)
  })
})
