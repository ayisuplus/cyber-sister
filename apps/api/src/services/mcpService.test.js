import { afterEach, describe, expect, it, vi } from 'vitest'

const mcp = vi.hoisted(() => {
  const clients = []
  // state 可变：每个用例在 connectServers 前设置本轮的 tools/callOutcome/连接错误
  const state = { tools: [], callOutcome: { content: [] }, connectErrors: [] }
  // 用 function 实现：mcpService 以 new Client(...) 构造，箭头函数不可作构造器
  const Client = vi.fn(function () {
    const client = {
      connect: vi.fn(async () => {
        const error = state.connectErrors.shift()
        if (error) throw error
      }),
      listTools: vi.fn(async () => ({ tools: state.tools })),
      callTool: vi.fn(async () => state.callOutcome),
      close: vi.fn(async () => {}),
    }
    clients.push(client)
    return client
  })
  const StdioClientTransport = vi.fn()
  return { clients, state, Client, StdioClientTransport }
})

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: mcp.Client }))
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: mcp.StdioClientTransport }))
vi.mock('../prisma/client.js', () => ({ default: {} }))
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import logger from '../utils/logger.js'
import { closeMcpClients, connectServers } from './mcpService.js'

const enable = (servers) => {
  process.env.MCP_ENABLED = 'true'
  process.env.MCP_SERVERS_JSON = JSON.stringify(servers)
}

afterEach(async () => {
  delete process.env.MCP_ENABLED
  delete process.env.MCP_SERVERS_JSON
  mcp.clients.length = 0
  mcp.state.tools = []
  mcp.state.callOutcome = { content: [] }
  mcp.state.connectErrors = []
  await closeMcpClients()
  vi.clearAllMocks()
})

describe('connectServers', () => {
  it('未启用时不连接不注册', async () => {
    const register = vi.fn()
    expect(await connectServers(register)).toEqual([])
    expect(mcp.Client).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
  })

  it('MCP_SERVERS_JSON 解析失败或非对象：记 error 并返回空', async () => {
    process.env.MCP_ENABLED = 'true'
    process.env.MCP_SERVERS_JSON = '{bad json'
    expect(await connectServers(vi.fn())).toEqual([])
    expect(logger.error).toHaveBeenCalled()

    vi.mocked(logger.error).mockClear()
    process.env.MCP_SERVERS_JSON = '[1]'
    expect(await connectServers(vi.fn())).toEqual([])
    expect(logger.error).toHaveBeenCalled()
  })

  it('缺 command 的 server warn 跳过', async () => {
    enable({ broken: { args: [] } })
    expect(await connectServers(vi.fn())).toEqual([])
    expect(logger.warn).toHaveBeenCalled()
    expect(mcp.Client).not.toHaveBeenCalled()
  })

  it('单 server 连接失败记 error 继续其余，返回连接成功名单', async () => {
    enable({
      bad: { command: 'missing-cmd' },
      good: { command: 'good-cmd', args: ['--x'], env: { A: '1' } },
    })
    mcp.state.connectErrors = [new Error('spawn 失败')]
    mcp.state.tools = [{ name: 'ping', description: '', inputSchema: {} }]
    const register = vi.fn(() => true)
    const connected = await connectServers(register)
    expect(connected).toEqual(['good'])
    expect(logger.error).toHaveBeenCalledWith('MCP 服务器连接失败', expect.objectContaining({ server: 'bad' }))
    expect(mcp.StdioClientTransport).toHaveBeenCalledWith({ command: 'good-cmd', args: ['--x'], env: { A: '1' } })
    const goodClient = mcp.clients.at(-1)
    expect(goodClient.connect).toHaveBeenCalledWith(expect.anything(), { timeout: 10_000 })
    expect(goodClient.listTools).toHaveBeenCalledWith({}, { timeout: 10_000 })
    expect(register).toHaveBeenCalledWith('mcp_good_ping', expect.any(Object))
  })

  it('注册名 sanitize + argsDoc 生成（required/可选/描述）', async () => {
    enable({ 'My Server': { command: 'cmd' } })
    mcp.state.tools = [{
      name: 'Read File',
      description: '读取文件',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          offset: { type: 'number' },
        },
        required: ['path'],
      },
    }]
    const register = vi.fn(() => true)
    expect(await connectServers(register)).toEqual(['My Server'])
    expect(register).toHaveBeenCalledWith(
      'mcp_my_server_read_file',
      expect.objectContaining({
        description: '{"tool":"mcp_my_server_read_file","args":{"path":"string 文件路径","offset":"number 可选"}} 读取文件',
      }),
    )
  })

  it('无 properties 的工具 argsDoc 为 {}；sanitize 为空的工具名跳过', async () => {
    enable({ fs: { command: 'cmd' } })
    mcp.state.tools = [
      { name: 'ping', description: '', inputSchema: { type: 'object' } },
      { name: '', description: '空名', inputSchema: {} },
    ]
    const register = vi.fn(() => true)
    await connectServers(register)
    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith('mcp_fs_ping', expect.objectContaining({
      description: '{"tool":"mcp_fs_ping","args":{}} ',
    }))
    expect(logger.warn).toHaveBeenCalledWith('MCP 工具名非法，跳过', expect.objectContaining({ tool: '' }))
  })

  it('每 server 工具超 20 截断；register 返回 false 记 warn 跳过', async () => {
    enable({ fs: { command: 'cmd' } })
    mcp.state.tools = Array.from({ length: 25 }, (_, i) => ({ name: `tool_${i}`, description: '', inputSchema: {} }))
    const register = vi.fn(() => true)
    await connectServers(register)
    expect(register).toHaveBeenCalledTimes(20)
    expect(logger.warn).toHaveBeenCalledWith('MCP 服务器工具数超限，截断', expect.objectContaining({ count: 25 }))

    vi.mocked(register).mockClear()
    register.mockReturnValue(false)
    await connectServers(register)
    expect(logger.warn).toHaveBeenCalledWith('MCP 工具注册失败（重名或非法），跳过', expect.objectContaining({ server: 'fs' }))
  })
})

describe('工具 run（callTool 映射）', () => {
  const setupTool = async () => {
    enable({ fs: { command: 'cmd' } })
    mcp.state.tools = [{
      name: 'echo',
      description: '回显',
      inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    }]
    const register = vi.fn(() => true)
    await connectServers(register)
    const [, tool] = register.mock.calls.at(-1)
    return { tool, client: mcp.clients.at(-1) }
  }

  it('文本内容拼接返回，非文本项 JSON 序列化', async () => {
    const { tool, client } = await setupTool()
    mcp.state.callOutcome = {
      content: [
        { type: 'text', text: '第一行' },
        { type: 'image', data: 'abc' },
        { type: 'text', text: '第二行' },
      ],
    }
    const out = await tool.run('u1', { message: 'hi' })
    expect(client.callTool).toHaveBeenCalledWith({ name: 'echo', arguments: { message: 'hi' } }, undefined, { timeout: 30_000 })
    expect(out).toEqual({ summary: '已调用 fs/echo', result: { content: '第一行\n{"type":"image","data":"abc"}\n第二行' } })
  })

  it('isError 透传为 400 原文', async () => {
    const { tool } = await setupTool()
    mcp.state.callOutcome = { isError: true, content: [{ type: 'text', text: '参数不对' }] }
    await expect(tool.run('u1', {})).rejects.toMatchObject({ statusCode: 400, message: '参数不对' })
  })

  it('超时/连接错误原样上抛', async () => {
    const { tool, client } = await setupTool()
    client.callTool.mockRejectedValue(new Error('MCP 调用超时'))
    await expect(tool.run('u1', {})).rejects.toThrow('MCP 调用超时')
  })
})

describe('closeMcpClients', () => {
  it('逐个关闭，单个失败 warn 继续其余，清空后幂等', async () => {
    enable({ a: { command: 'cmd' }, b: { command: 'cmd' } })
    await connectServers(vi.fn(() => true))
    const [clientA, clientB] = mcp.clients.slice(-2)
    clientA.close.mockRejectedValue(new Error('关闭失败'))
    await closeMcpClients()
    expect(clientA.close).toHaveBeenCalled()
    expect(clientB.close).toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith('MCP 客户端关闭失败', expect.objectContaining({}))
    await closeMcpClients()
    expect(clientA.close).toHaveBeenCalledTimes(1)
    expect(clientB.close).toHaveBeenCalledTimes(1)
  })
})
