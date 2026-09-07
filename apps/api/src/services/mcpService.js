/**
 * 工作模式 MCP 服务：stdio MCP server 的连接、工具注册与生命周期。
 *
 * MCP_SERVERS_JSON 形如 {"<server>":{"command":"...","args":[...],"env":{...}}}，
 * 每个 server 以 stdio 子进程拉起，工具注册为 mcp_<server>_<tool> 进入工作
 * 模式注册表。MCP server 在本机执行任意代码，与 bash_run 同级信任；默认关闭，
 * MCP_ENABLED=true 显式开启。子进程随 API 进程生命周期，重启即重连。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'

const MAX_TOOLS_PER_SERVER = 20
const MAX_TOOL_NAME_LENGTH = 64
const CONNECT_TIMEOUT_MS = 10_000
const CALL_TIMEOUT_MS = 30_000

const isMcpEnabled = () => process.env.MCP_ENABLED === 'true'

const sanitize = (value) => String(value).toLowerCase().replace(/[^a-z0-9_]/g, '_')

function clip(text, max = 60) {
  const value = String(text ?? '')
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** 由 inputSchema 生成目录行 args 文档：标注类型/可选/描述。 */
function buildArgsDoc(inputSchema) {
  const properties = inputSchema?.properties
  if (!properties || typeof properties !== 'object') return '{}'
  const required = Array.isArray(inputSchema?.required) ? inputSchema.required : []
  const entries = Object.entries(properties).map(([key, schema]) => {
    let doc = String(schema?.type ?? 'any')
    if (!required.includes(key)) doc += ' 可选'
    if (schema?.description) doc += ` ${schema.description}`
    return `"${key}":"${doc}"`
  })
  return `{${entries.join(',')}}`
}

const clients = []

/** 注册单个 server 的工具表：名称非法或冲突 warn 跳过，超出上限截断。 */
function registerServerTools(register, serverName, client, tools) {
  const list = tools ?? []
  if (list.length > MAX_TOOLS_PER_SERVER) {
    logger.warn('MCP 服务器工具数超限，截断', { server: serverName, count: list.length })
  }
  for (const tool of list.slice(0, MAX_TOOLS_PER_SERVER)) {
    const serverPart = sanitize(serverName)
    const toolPart = sanitize(tool.name)
    if (!serverPart || !toolPart) {
      logger.warn('MCP 工具名非法，跳过', { server: serverName, tool: tool?.name })
      continue
    }
    const registeredName = `mcp_${serverPart}_${toolPart}`.slice(0, MAX_TOOL_NAME_LENGTH)
    const ok = register(registeredName, {
      description: `{"tool":"${registeredName}","args":${buildArgsDoc(tool.inputSchema)}} ${tool.description ?? ''}`,
      run: async (_userId, args) => {
        const outcome = await client.callTool(
          { name: tool.name, arguments: args ?? {} },
          undefined,
          { timeout: CALL_TIMEOUT_MS },
        )
        const text = (outcome.content ?? [])
          .map((item) => (item.type === 'text' ? item.text : JSON.stringify(item)))
          .join('\n')
        if (outcome.isError === true) throw new HttpError(clip(text, 100), 400)
        return { summary: clip(`已调用 ${serverName}/${tool.name}`), result: { content: text } }
      },
    })
    if (!ok) logger.warn('MCP 工具注册失败（重名或非法），跳过', { server: serverName, tool: tool.name, name: registeredName })
  }
}

/**
 * 连接 MCP_SERVERS_JSON 配置的全部 server 并注册其工具。
 * 单 server 失败记日志继续其余；返回连接成功的 serverName 数组。
 */
export async function connectServers(register) {
  if (!isMcpEnabled()) return []
  let servers
  try {
    servers = JSON.parse(process.env.MCP_SERVERS_JSON || '{}')
  } catch (error) {
    logger.error('MCP_SERVERS_JSON 解析失败', { error: error.message })
    return []
  }
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    logger.error('MCP_SERVERS_JSON 不是对象，跳过 MCP 连接')
    return []
  }
  const connected = []
  for (const [serverName, config] of Object.entries(servers)) {
    if (!config?.command) {
      logger.warn('MCP 服务器缺少 command，跳过', { server: serverName })
      continue
    }
    try {
      const client = new Client({ name: 'cyber-sister', version: '1.0.0' })
      // server 逐个串行连接：单路失败隔离，避免并发 spawn 互相拖累
      // eslint-disable-next-line no-await-in-loop
      await client.connect(
        new StdioClientTransport({ command: config.command, args: config.args, env: config.env }),
        { timeout: CONNECT_TIMEOUT_MS },
      )
      // eslint-disable-next-line no-await-in-loop
      const { tools } = await client.listTools({}, { timeout: CONNECT_TIMEOUT_MS })
      clients.push(client)
      registerServerTools(register, serverName, client, tools)
      connected.push(serverName)
    } catch (error) {
      logger.error('MCP 服务器连接失败', { server: serverName, error: error.message })
    }
  }
  return connected
}

/** 关停全部 MCP 客户端：单个失败 warn 继续，结束时清空列表。供进程退出调用。 */
export async function closeMcpClients() {
  while (clients.length > 0) {
    const client = clients.pop()
    try {
      // 串行关闭，单个失败不阻塞其余客户端回收
      // eslint-disable-next-line no-await-in-loop
      await client.close()
    } catch (error) {
      logger.warn('MCP 客户端关闭失败', { error: error.message })
    }
  }
}
