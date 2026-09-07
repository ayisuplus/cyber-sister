import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { isSearchEnabled, searchWeb } from './searchService.js'

// 联网搜索的诚实降级契约：未启用/网络异常/上游异常一律 503，
// 空关键词 400，结果解析走 DuckDuckGo HTML 形态并解出 uddg 真实地址。
describe('searchService', () => {
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

  it('关键词为空或纯空白时抛 400，且未开启时先报未启用', async () => {
    process.env.SEARCH_ENABLED = 'true'
    await expect(searchWeb('u1', '   ')).rejects.toMatchObject({
      statusCode: 400,
      message: '搜索关键词不能为空',
    })
    await expect(searchWeb('u1', undefined)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('网络异常时抛 503 SEARCH_UNAVAILABLE', async () => {
    process.env.SEARCH_ENABLED = 'true'
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    await expect(searchWeb('u1', 'x')).rejects.toMatchObject({
      statusCode: 503,
      code: 'SEARCH_UNAVAILABLE',
    })
  })

  it('上游非 2xx 时抛 503 SEARCH_UNAVAILABLE', async () => {
    process.env.SEARCH_ENABLED = 'true'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => '' })))
    await expect(searchWeb('u1', 'x')).rejects.toMatchObject({ statusCode: 503 })
  })

  it('解析 DuckDuckGo HTML 结果：解出 uddg 真实地址、去标签、截断并配对摘要', async () => {
    process.env.SEARCH_ENABLED = 'true'
    const html = `
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Freal.example%2Farticle&rut=x">
        <b>真实标题</b> &amp; 副标题
      </a>
      <a class="result__snippet">摘要一 &lt;em&gt;高亮&lt;/em&gt; 正文</a>
      <a class="result__a" href="https://direct.example/news">直达标题</a>
      <a class="result__snippet">摘要二</a>
      <a class="result__a" href="javascript:void(0)">非法链接应被丢弃</a>
    `
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => html })))

    const result = await searchWeb('u1', '测试关键词')

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('q=%E6%B5%8B%E8%AF%95%E5%85%B3%E9%94%AE%E8%AF%8D'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(result.query).toBe('测试关键词')
    expect(result.results).toEqual([
      { url: 'https://real.example/article', title: '真实标题 & 副标题', snippet: '摘要一 <em>高亮</em> 正文' },
      { url: 'https://direct.example/news', title: '直达标题', snippet: '摘要二' },
    ])
  })

  it('结果为空时返回空数组而不是报错', async () => {
    process.env.SEARCH_ENABLED = 'true'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '<html><body>无结果</body></html>' })))
    const result = await searchWeb('u1', '冷门词')
    expect(result).toEqual({ query: '冷门词', results: [] })
  })

  it('关键词超长时截断到 100 字符', async () => {
    process.env.SEARCH_ENABLED = 'true'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '' })))
    const longQuery = '长'.repeat(150)
    const result = await searchWeb('u1', longQuery)
    expect(result.query).toHaveLength(100)
  })
})
