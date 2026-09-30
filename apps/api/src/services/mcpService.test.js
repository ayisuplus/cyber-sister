import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const sdk = vi.hoisted(() => ({
  connect: vi.fn(),
  listTools: vi.fn(),
  callTool: vi.fn(),
  close: vi.fn(() => Promise.resolve()),
  transports: [],
}))

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class MockClient {
    constructor() {
      return { connect: sdk.connect, listTools: sdk.listTools, callTool: sdk.callTool, close: sdk.close }
    }
  },
}))
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class MockTransport {
    constructor(options) { sdk.transports.push(options) }
  },
}))

import logger from '../utils/logger.js'
import { initMcp, mcpToolParameters, mcpTools, parseMcpServers, shutdownMcp } from './mcpService.js'

const ENV = {
  MCP_SERVERS_JSON: JSON.stringify({
    newsnow: { command: 'npx', args: ['-y', 'newsnow-mcp-server'], env: { BASE_URL: 'http://127.0.0.1:4444' }, readOnly: true },
  }),
}

const HOT_TOOL = {
  name: 'get_hottest_latest_news',
  description: '查询热榜',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
}

beforeEach(async () => {
  await shutdownMcp()
  vi.clearAllMocks()
  sdk.transports.length = 0
  sdk.connect.mockResolvedValue(undefined)
  sdk.listTools.mockResolvedValue({ tools: [HOT_TOOL] })
  sdk.callTool.mockResolvedValue({ content: [{ type: 'text', text: '1. 热榜第一条' }] })
})

describe('parseMcpServers', () => {
  it('没配就是空；坏 JSON 与坏条目各跳各的，不留残次品', () => {
    expect(parseMcpServers({})).toEqual({})
    expect(parseMcpServers({ MCP_SERVERS_JSON: '{bad' })).toEqual({})
    const servers = parseMcpServers({
      MCP_SERVERS_JSON: JSON.stringify({
        ok: { command: 'npx', args: ['-y', 'x'], env: { A: '1', B: 2 }, readOnly: true },
        'bad key!': { command: 'npx' },
        noCommand: { args: ['-y', 'x'] },
      }),
    })
    expect(Object.keys(servers)).toEqual(['ok'])
    expect(servers.ok).toEqual({ command: 'npx', args: ['-y', 'x'], env: { A: '1' }, readOnly: true })
    expect(logger.warn).toHaveBeenCalled()
  })

  it('子进程环境只给最小集加显式 env，不把密钥顺手带出去', async () => {
    process.env.DATABASE_URL = 'postgresql://secret'
    sdk.transports.length = 0
    await initMcp({ env: ENV })
    const [options] = sdk.transports
    expect(options.env.BASE_URL).toBe('http://127.0.0.1:4444')
    expect(options.env.DATABASE_URL).toBeUndefined()
    expect(options.env.PATH).toBe(process.env.PATH)
    delete process.env.DATABASE_URL
  })
})

describe('initMcp：工具登记', () => {
  it('工具名带 server 前缀、schema 原样透传、readOnly 的免确认卡', async () => {
    const count = await initMcp({ env: ENV })
    expect(count).toBe(1)
    expect(Object.keys(mcpTools())).toEqual(['newsnow_get_hottest_latest_news'])
    expect(mcpToolParameters().newsnow_get_hottest_latest_news).toEqual(HOT_TOOL.inputSchema)
    expect(mcpTools().newsnow_get_hottest_latest_news.needsConfirm()).toBe(false)
    expect(mcpTools().newsnow_get_hottest_latest_news.description).toContain('查询热榜')
  })

  it('没标 readOnly 的工具默认走确认卡；工具自带 readOnlyHint 才免', async () => {
    sdk.listTools.mockResolvedValue({
      tools: [
        { name: 'danger', description: '会改东西', inputSchema: { type: 'object' } },
        { name: 'peek', description: '只读', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
      ],
    })
    await initMcp({ env: { MCP_SERVERS_JSON: JSON.stringify({ plug: { command: 'node' } }) } })
    expect(mcpTools().plug_danger.needsConfirm()).toBe('执行「danger」')
    expect(mcpTools().plug_peek.needsConfirm()).toBe(false)
  })

  it('与保留名重名的拒收', async () => {
    sdk.listTools.mockResolvedValue({ tools: [{ ...HOT_TOOL, name: 'web_search' }] })
    const count = await initMcp({ env: ENV, reservedToolNames: ['newsnow_web_search'] })
    expect(count).toBe(0)
    expect(logger.warn).toHaveBeenCalledWith('MCP 工具注册被拒', expect.objectContaining({ server: 'newsnow' }))
  })

  it('server 连不上只跳过它，不阻塞启动', async () => {
    sdk.connect.mockRejectedValue(new Error('spawn ENOENT'))
    await expect(initMcp({ env: ENV })).resolves.toBe(0)
    expect(logger.warn).toHaveBeenCalledWith('MCP server 接入失败，已跳过', expect.objectContaining({ server: 'newsnow' }))
  })
})

describe('callTool 与收尾', () => {
  it('调用带回文本结果并标 untrusted；工具报错如实 502', async () => {
    await initMcp({ env: ENV })
    const run = mcpTools().newsnow_get_hottest_latest_news.run
    await expect(run('u1', { id: 'weibo' }, {})).resolves.toEqual({
      summary: '已查询：get_hottest_latest_news',
      result: { output: '1. 热榜第一条', untrusted: true },
    })
    expect(sdk.callTool).toHaveBeenCalledWith({ name: 'get_hottest_latest_news', arguments: { id: 'weibo' } }, undefined, expect.objectContaining({ timeout: 30_000 }))

    sdk.callTool.mockResolvedValue({ isError: true, content: [{ type: 'text', text: '来源不支持' }] })
    await expect(run('u1', { id: 'x' }, {})).rejects.toMatchObject({ statusCode: 502, message: '来源不支持' })
  })

  it('连接死掉丢缓存下次重连；shutdown 后目录清空', async () => {
    await initMcp({ env: ENV })
    const run = mcpTools().newsnow_get_hottest_latest_news.run
    sdk.callTool.mockRejectedValueOnce(new Error('EPIPE'))
    await expect(run('u1', { id: 'weibo' }, {})).rejects.toMatchObject({ statusCode: 502 })
    await run('u1', { id: 'weibo' }, {})
    expect(sdk.connect).toHaveBeenCalledTimes(2)

    await shutdownMcp()
    expect(sdk.close).toHaveBeenCalled()
    expect(Object.keys(mcpTools())).toEqual([])
  })

  it('取消信号落在调用上：AbortError 原样冒泡，不当成工具失败', async () => {
    await initMcp({ env: ENV })
    const controller = new AbortController()
    controller.abort()
    const run = mcpTools().newsnow_get_hottest_latest_news.run
    await expect(run('u1', { id: 'weibo' }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
