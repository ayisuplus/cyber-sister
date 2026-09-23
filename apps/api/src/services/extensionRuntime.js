/**
 * 扩展运行时：仓库内扩展的加载器与 ExtensionAPI 子集（工厂形状、事件名与语义对齐 pi，便于日后迁移）。
 *
 * 扩展 = 默认导出工厂 `(pi) => void | Promise<void>` 的 .js 模块，只由团队在仓库内提供（不做 npm/git/URL 远程安装）：
 *   ① <repo>/.pi/extensions/     项目级覆盖
 *   ② apps/api/src/extensions/   随应用分发
 * 每目录收根下 *.js 与一层子目录的 index.js，不递归；AGENT_EXTENSIONS_ENABLED ≠ 'true' 时整组跳过并记一次日志。
 * 单个扩展 import 或工厂抛错只跳过它自己；不做热重载（dev 用 node --watch，重启即重载）。
 *
 * pi 对象：on(event, handler) → unsubscribe、registerTool(def)、registerSkillPath(path)、events（扩展互通总线）。
 * registerCommand / ctx.ui / registerProvider 不提供（web 聊天无斜杠命令、TUI 或运行时供应商面），调用即 TypeError。
 *
 * 事件 handler 签名 `(event, ctx) => result | void`，ctx = { userId?, conversationId?, signal? }：
 *   session_start / session_shutdown / agent_start / agent_end / turn_start   → void
 *   resources_discover  → { skillPaths?: string[] }
 *   input               → { action: 'continue' } | { action: 'transform', text }（'handled' 不支持，按 continue 并 warn）
 *   context             → { appendSystem?: string[] }（各家拼接，按序追加）
 *   tool_call           → { block?: boolean, reason?: string, terminate?: boolean }（args 可原地改）
 *   tool_result         → { summary?, result?, feedback?, ok? } 部分补丁（链式，后者见前者的补丁结果）
 *   turn_end            → { continue?: boolean }
 * 同事件多 handler 按「扩展加载序 → 注册序」执行；一般 handler 抛错记日志后继续，
 * tool_call handler 抛错则 fail-safe 阻断（安全起见先拦下）。
 */
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadSkillCatalog } from './skillCatalog.js'
import logger from '../utils/logger.js'

const PROJECT_EXTENSIONS_DIR = fileURLToPath(new URL('../../../../.pi/extensions/', import.meta.url))
const BUILTIN_EXTENSIONS_DIR = fileURLToPath(new URL('../extensions/', import.meta.url))
const FAIL_SAFE_REASON = '扩展执行出错，安全起见先拦下这个动作'

// 生命周期 handler：数组保持「扩展加载序 → 注册序」
const handlers = []
// name → { adapter, extensionPath }；内置工具名在 initExtensions 时传入，不允许覆盖
const tools = new Map()
const skillPaths = new Set()
const reservedToolNames = new Set()
// pi.events：扩展互通的简单总线，与生命周期事件分开
const busHandlers = new Map()
let initialized = false

function resetState() {
  handlers.length = 0
  tools.clear()
  skillPaths.clear()
  reservedToolNames.clear()
  busHandlers.clear()
  initialized = false
}

function handlersOf(event) {
  return handlers.filter((entry) => entry.event === event)
}

function logHandlerError(entry, event, error) {
  logger.error('扩展事件处理出错', { extension: entry.extensionPath, event, error: error?.message || String(error) })
}

/** tool_call：args 可被 handler 原地改写；任一 handler block 即短路后续并阻断；抛错 fail-safe 阻断。 */
async function emitToolCall(evt, ctx) {
  for (const entry of handlersOf(evt.type)) {
    let result
    try {
      // eslint-disable-next-line no-await-in-loop -- 链式：后者见前者的 args 改写，必须按序等待
      result = await entry.handler(evt, ctx)
    } catch (error) {
      logHandlerError(entry, evt.type, error)
      return { block: true, reason: FAIL_SAFE_REASON }
    }
    if (result?.block) return { block: true, reason: result.reason, terminate: result.terminate }
  }
  return null
}

/** input：transform 链式（后者见前者的文本）；'handled' 不支持，按 continue 处理并 warn。 */
async function emitInput(evt, ctx) {
  for (const entry of handlersOf(evt.type)) {
    let result
    try {
      // eslint-disable-next-line no-await-in-loop -- transform 链式：后者见前者的文本
      result = await entry.handler(evt, ctx)
    } catch (error) {
      logHandlerError(entry, evt.type, error)
      continue
    }
    if (result?.action === 'transform' && typeof result.text === 'string') {
      evt.text = result.text
    } else if (result?.action === 'handled') {
      logger.warn('input 的 { action: "handled" } 不支持，按 continue 处理', { extension: entry.extensionPath })
    }
  }
  return evt.text
}

/** tool_result：{summary?, result?, feedback?, ok?} 部分补丁链式，后者见前者的补丁结果。 */
async function emitToolResult(evt, ctx) {
  for (const entry of handlersOf(evt.type)) {
    let patch
    try {
      // eslint-disable-next-line no-await-in-loop -- 补丁链式：后者见前者的补丁结果
      patch = await entry.handler(evt, ctx)
    } catch (error) {
      logHandlerError(entry, evt.type, error)
      continue
    }
    if (!patch || typeof patch !== 'object') continue
    for (const key of ['summary', 'result', 'feedback', 'ok']) {
      if (patch[key] !== undefined) evt.result[key] = patch[key]
    }
  }
  return evt.result
}

/** context：各家 appendSystem（string[]）按注册序拼接。 */
async function emitContext(evt, ctx) {
  const appendSystem = []
  for (const entry of handlersOf(evt.type)) {
    try {
      // eslint-disable-next-line no-await-in-loop -- 按注册序拼接
      const result = await entry.handler(evt, ctx)
      if (Array.isArray(result?.appendSystem)) appendSystem.push(...result.appendSystem.filter((line) => typeof line === 'string'))
    } catch (error) {
      logHandlerError(entry, evt.type, error)
    }
  }
  return { appendSystem }
}

/** resources_discover：收集扩展贡献的技能路径。 */
async function emitDiscover(evt, ctx) {
  const paths = []
  for (const entry of handlersOf(evt.type)) {
    try {
      // eslint-disable-next-line no-await-in-loop -- 按注册序收集
      const result = await entry.handler(evt, ctx)
      if (Array.isArray(result?.skillPaths)) paths.push(...result.skillPaths.filter((item) => typeof item === 'string'))
    } catch (error) {
      logHandlerError(entry, evt.type, error)
    }
  }
  return { skillPaths: paths }
}

/** turn_end：任一 handler 返回 { continue: true } 就续写一轮。 */
async function emitTurnEnd(evt, ctx) {
  let shouldContinue = false
  for (const entry of handlersOf(evt.type)) {
    try {
      // eslint-disable-next-line no-await-in-loop -- 按注册序询问
      const result = await entry.handler(evt, ctx)
      if (result?.continue) shouldContinue = true
    } catch (error) {
      logHandlerError(entry, evt.type, error)
    }
  }
  return { continue: shouldContinue }
}

/** 生命周期事件：按序广播，handler 抛错只跳过自己。 */
async function emitBroadcast(evt, ctx) {
  for (const entry of handlersOf(evt.type)) {
    try {
      // eslint-disable-next-line no-await-in-loop -- 生命周期事件按序广播
      await entry.handler(evt, ctx)
    } catch (error) {
      logHandlerError(entry, evt.type, error)
    }
  }
  return undefined
}

/** 单个事件的链式派发：返回按事件类型合并的结果；一般 handler 抛错只跳过自己。 */
export function emit(event, payload, ctx = {}) {
  const evt = { type: event, ...payload }
  if (event === 'tool_call') return emitToolCall(evt, ctx)
  if (event === 'input') return emitInput(evt, ctx)
  if (event === 'tool_result') return emitToolResult(evt, ctx)
  if (event === 'context') return emitContext(evt, ctx)
  if (event === 'resources_discover') return emitDiscover(evt, ctx)
  if (event === 'turn_end') return emitTurnEnd(evt, ctx)
  return emitBroadcast(evt, ctx)
}

function registerTool(extensionPath, def) {
  const name = def?.name
  const invalid = (reason) => logger.warn('扩展工具注册被拒', { extension: extensionPath, name, reason })
  if (typeof name !== 'string' || !name) return invalid('name 必须是非空字符串')
  if (typeof def.description !== 'string' || !def.description) return invalid('description 必须是非空字符串')
  if (typeof def.execute !== 'function') return invalid('execute 必须是函数')
  if (!def.parameters || typeof def.parameters !== 'object' || def.parameters.type !== 'object') {
    return invalid('parameters 必须是 type: "object" 的 JSON Schema')
  }
  if (reservedToolNames.has(name)) return invalid('与内置工具重名，不许覆盖')
  if (tools.has(name)) return invalid('与其他扩展工具重名')
  // 扩展工具默认走确认卡：只有显式 readOnly 或自定义 needsConfirm 才能免确认
  const needsConfirm = def.needsConfirm
    ?? (def.readOnly === true ? () => false : () => `执行「${def.label || def.name}」`)
  tools.set(name, {
    extensionPath,
    adapter: {
      description: def.description,
      parameters: def.parameters,
      needsConfirm,
      run: (userId, args, context = {}) => Promise.resolve(
        def.execute(context.toolCallId, args, {
          signal: context.signal,
          userId,
          conversationId: context.conversationId,
        }),
      ),
    },
  })
  return undefined
}

function registerSkillPath(p) {
  const resolved = path.resolve(String(p))
  skillPaths.add(resolved)
  // 初始化期收集完统一灌给技能目录；初始化后注册的立即生效
  if (initialized) loadSkillCatalog({ extraPaths: [resolved] })
}

function createExtensionApi(extensionPath) {
  return {
    on(event, handler) {
      const entry = { extensionPath, event, handler }
      handlers.push(entry)
      return () => {
        const index = handlers.indexOf(entry)
        if (index !== -1) handlers.splice(index, 1)
      }
    },
    registerTool: (def) => registerTool(extensionPath, def),
    registerSkillPath,
    events: {
      on(event, handler) {
        if (!busHandlers.has(event)) busHandlers.set(event, new Set())
        busHandlers.get(event).add(handler)
        return () => busHandlers.get(event)?.delete(handler)
      },
      off(event, handler) {
        busHandlers.get(event)?.delete(handler)
      },
      emit(event, ...args) {
        for (const handler of [...(busHandlers.get(event) ?? [])]) {
          try {
            handler(...args)
          } catch (error) {
            logger.error('扩展 events 总线处理出错', { event, error: error?.message || String(error) })
          }
        }
      },
    },
  }
}

/** 一个来源目录：根下 .js 与一层子目录的 index.js，逐个加载，互不影响。 */
async function loadExtensionsFrom(root) {
  if (!existsSync(root)) return
  const files = []
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name.startsWith('.')) continue
    if (entry.isFile() && entry.name.endsWith('.js')) files.push(path.join(root, entry.name))
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      const indexFile = path.join(root, entry.name, 'index.js')
      if (existsSync(indexFile)) files.push(indexFile)
    }
  }
  for (const file of files) {
    try {
      // eslint-disable-next-line no-await-in-loop -- 扩展加载序必须确定，逐个等待
      const module = await import(pathToFileURL(file).href)
      const factory = module.default
      if (typeof factory !== 'function') {
        logger.error('扩展默认导出不是工厂函数，已跳过', { extension: file })
        continue
      }
      // eslint-disable-next-line no-await-in-loop -- 工厂完成才算加载完（pi 语义）
      await factory(createExtensionApi(file))
    } catch (error) {
      logger.error('扩展加载失败，已跳过', { extension: file, error: error?.message || String(error) })
    }
  }
}

/**
 * 加载扩展并启动：加载工厂 → resources_discover 收集技能路径 → session_start。
 * dirs 缺省扫 <repo>/.pi/extensions/ 与 apps/api/src/extensions/；reservedToolNames 是内置工具名（不许覆盖）。
 */
export async function initExtensions({ dirs, reservedToolNames: reserved = [] } = {}) {
  resetState()
  for (const name of reserved) reservedToolNames.add(name)
  const enabled = process.env.AGENT_EXTENSIONS_ENABLED ?? 'true'
  if (enabled !== 'true') {
    logger.info('扩展未启用（AGENT_EXTENSIONS_ENABLED），已整组跳过')
    return
  }
  for (const root of dirs ?? [PROJECT_EXTENSIONS_DIR, BUILTIN_EXTENSIONS_DIR]) {
    // eslint-disable-next-line no-await-in-loop -- 保持扩展加载序确定
    await loadExtensionsFrom(root)
  }
  const discovered = await emit('resources_discover', { reason: 'startup' }, {})
  registerSkillPaths(discovered.skillPaths)
  initialized = true
  if (skillPaths.size) loadSkillCatalog({ extraPaths: [...skillPaths] })
  await emit('session_start', { reason: 'startup' }, {})
}

function registerSkillPaths(paths = []) {
  for (const item of paths) skillPaths.add(path.resolve(String(item)))
}

/** 进程退出路径调用：广播 session_shutdown 后清空注册表；重复调用无副作用。 */
export async function shutdownExtensions() {
  if (initialized || handlers.length) await emit('session_shutdown', { reason: 'shutdown' }, {})
  resetState()
}

/** name → 适配进既有工具契约的对象（run(userId, args, context) / needsConfirm(userId, args)）。 */
export function extensionTools() {
  return Object.fromEntries([...tools].map(([name, { adapter }]) => [name, adapter]))
}

/** name → JSON Schema 参数结构。 */
export function extensionToolParameters() {
  return Object.fromEntries([...tools].map(([name, { adapter }]) => [name, adapter.parameters]))
}
