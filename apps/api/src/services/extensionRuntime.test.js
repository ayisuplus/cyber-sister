import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('../utils/logger.js', () => ({ default: logger }))
vi.mock('../prisma/client.js', () => ({ default: {} }))
vi.mock('./searchService.js', () => ({ searchWeb: vi.fn() }))

import { executeToolCall, runConfirmedTool } from './agentService.js'
import { emit, extensionToolParameters, extensionTools, initExtensions, shutdownExtensions } from './extensionRuntime.js'
import { getSkill, resetSkillCatalog } from './skillCatalog.js'

const FIXTURE_EXTENSIONS = fileURLToPath(new URL('./__fixtures__/extensions/', import.meta.url))

describe('extensionRuntime 发现与工具注册', () => {
  let tempRoot
  beforeEach(async () => {
    vi.clearAllMocks()
    resetSkillCatalog()
    await shutdownExtensions()
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'amie-ext-'))
  })
  afterEach(async () => {
    await shutdownExtensions()
    resetSkillCatalog()
    vi.unstubAllEnvs()
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('hello-tool 的工具进入扩展工具表：readOnly 免确认，默认要确认卡', async () => {
    await initExtensions({ dirs: [FIXTURE_EXTENSIONS] })
    const tools = extensionTools()
    expect(Object.keys(tools).sort()).toEqual(['hello_tool', 'hello_write'])
    expect(tools.hello_tool.needsConfirm('u1', {})).toBe(false)
    expect(tools.hello_write.needsConfirm('u1', {})).toBe('执行「hello_write」')
    expect(tools.hello_tool.description).toContain('"tool":"hello_tool"')
    expect(extensionToolParameters().hello_tool).toMatchObject({ type: 'object', required: ['name'] })
  })

  it('扩展工具 run 透传 execute 的返回，并把 toolCallId/context 交给它', async () => {
    await initExtensions({ dirs: [FIXTURE_EXTENSIONS] })
    const run = await extensionTools().hello_tool.run('u1', { name: 'Amie' }, { toolCallId: 'tc-1', conversationId: 'c1' })
    expect(run).toEqual({ summary: '打了个招呼', result: { toolCallId: 'tc-1', text: 'hi Amie' } })
  })

  it('工具重名拒注并 warn：内置名与其他扩展工具都拦', async () => {
    writeFileSync(path.join(tempRoot, 'dup.js'), `export default (pi) => {
      pi.registerTool({ name: 'builtin_name', description: '抢内置名', parameters: { type: 'object' }, execute: async () => ({}) })
      pi.registerTool({ name: 'hello_tool', description: '抢别家的名', parameters: { type: 'object' }, execute: async () => ({}) })
      pi.registerTool({ name: 'twice', description: '第一次', parameters: { type: 'object' }, execute: async () => ({}) })
      pi.registerTool({ name: 'twice', description: '第二次', parameters: { type: 'object' }, execute: async () => ({}) })
    }`)
    await initExtensions({ dirs: [FIXTURE_EXTENSIONS, tempRoot], reservedToolNames: ['builtin_name'] })
    expect(Object.keys(extensionTools()).sort()).toEqual(['hello_tool', 'hello_write', 'twice'])
    expect(logger.warn).toHaveBeenCalledWith('扩展工具注册被拒', expect.objectContaining({ name: 'builtin_name', reason: '与内置工具重名，不许覆盖' }))
    expect(logger.warn).toHaveBeenCalledWith('扩展工具注册被拒', expect.objectContaining({ name: 'hello_tool', reason: '与其他扩展工具重名' }))
    expect(logger.warn).toHaveBeenCalledWith('扩展工具注册被拒', expect.objectContaining({ name: 'twice', reason: '与其他扩展工具重名' }))
  })

  it('parameters 不是 type:object 的 JSON Schema 就拒注并 warn', async () => {
    writeFileSync(path.join(tempRoot, 'bad.js'), `export default (pi) => {
      pi.registerTool({ name: 'bad_tool', description: '没参数结构', execute: async () => ({}) })
    }`)
    await initExtensions({ dirs: [tempRoot] })
    expect(extensionTools().bad_tool).toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith('扩展工具注册被拒', expect.objectContaining({ name: 'bad_tool', reason: 'parameters 必须是 type: "object" 的 JSON Schema' }))
  })

  it('默认导出不是工厂函数只跳过自己，其余照常加载', async () => {
    writeFileSync(path.join(tempRoot, 'broken.js'), 'export default 42\n')
    writeFileSync(path.join(tempRoot, 'throws.js'), `export default () => { throw new Error('工厂炸了') }\n`)
    await initExtensions({ dirs: [tempRoot, FIXTURE_EXTENSIONS] })
    expect(Object.keys(extensionTools()).sort()).toEqual(['hello_tool', 'hello_write'])
    expect(logger.error).toHaveBeenCalledWith('扩展默认导出不是工厂函数，已跳过', expect.objectContaining({ extension: expect.stringContaining('broken.js') }))
    expect(logger.error).toHaveBeenCalledWith('扩展加载失败，已跳过', expect.objectContaining({ extension: expect.stringContaining('throws.js'), error: '工厂炸了' }))
  })

  it('AGENT_EXTENSIONS_ENABLED 不是 true 时整组跳过并记一次日志', async () => {
    vi.stubEnv('AGENT_EXTENSIONS_ENABLED', 'false')
    await initExtensions({ dirs: [FIXTURE_EXTENSIONS] })
    expect(extensionTools()).toEqual({})
    expect(logger.info).toHaveBeenCalledWith('扩展未启用（AGENT_EXTENSIONS_ENABLED），已整组跳过')
  })

  it('pi 对象没有 registerCommand/ctx.ui/registerProvider，调用即 TypeError', async () => {
    writeFileSync(path.join(tempRoot, 'capture.js'), 'export default (pi) => { globalThis.__capturedPi = pi }\n')
    await initExtensions({ dirs: [tempRoot] })
    const pi = globalThis.__capturedPi
    delete globalThis.__capturedPi
    expect(pi.registerCommand).toBeUndefined()
    expect(pi.ctx).toBeUndefined()
    expect(() => pi.registerCommand('x')).toThrowError(TypeError)
    expect(typeof pi.on).toBe('function')
    expect(typeof pi.registerTool).toBe('function')
    expect(typeof pi.registerSkillPath).toBe('function')
    expect(typeof pi.events.on).toBe('function')
  })
})

describe('extensionRuntime 事件链式语义', () => {
  let tempRoot
  beforeEach(async () => {
    vi.clearAllMocks()
    resetSkillCatalog()
    await shutdownExtensions()
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'amie-ext-'))
  })
  afterEach(async () => {
    await shutdownExtensions()
    resetSkillCatalog()
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('input transform 链式：后者见前者的文本；handled 降级 continue 并 warn', async () => {
    mkdirSync(path.join(tempRoot, 'a'), { recursive: true })
    mkdirSync(path.join(tempRoot, 'b'), { recursive: true })
    writeFileSync(path.join(tempRoot, 'a', 'index.js'), `export default (pi) => {
      pi.on('input', (event) => ({ action: 'transform', text: event.text + '甲' }))
      pi.on('input', () => ({ action: 'handled' }))
    }`)
    writeFileSync(path.join(tempRoot, 'b', 'index.js'), `export default (pi) => {
      pi.on('input', (event) => ({ action: 'transform', text: event.text + '乙' }))
    }`)
    await initExtensions({ dirs: [path.join(tempRoot, 'a'), path.join(tempRoot, 'b')] })
    expect(await emit('input', { text: '前' }, {})).toBe('前甲乙')
    expect(logger.warn).toHaveBeenCalledWith('input 的 { action: "handled" } 不支持，按 continue 处理', expect.any(Object))
  })

  it('tool_call args 原地改写后 handler 可见；block 短路后续 handler', async () => {
    const seen = vi.fn()
    globalThis.__toolCallSeen = seen
    writeFileSync(path.join(tempRoot, 'chain.js'), `export default (pi) => {
      pi.on('tool_call', (event) => { event.args.name = '改过' })
      pi.on('tool_call', (event) => { globalThis.__toolCallSeen(event.args.name, event.toolName); return { block: true, reason: '乙拦下' } })
      pi.on('tool_call', () => { globalThis.__toolCallSeen('丙被短路') })
    }`)
    await initExtensions({ dirs: [tempRoot] })
    const result = await emit('tool_call', { toolCallId: 'tc-1', toolName: 'some_tool', args: { name: '原样' } }, {})
    delete globalThis.__toolCallSeen
    expect(result).toEqual({ block: true, reason: '乙拦下', terminate: undefined })
    expect(seen.mock.calls).toEqual([['改过', 'some_tool']])
  })

  it('tool_result 补丁链式覆盖 summary，后者见前者的补丁结果', async () => {
    const seen = vi.fn()
    globalThis.__patchSeen = seen
    writeFileSync(path.join(tempRoot, 'patch.js'), `export default (pi) => {
      pi.on('tool_result', () => ({ summary: '甲' }))
      pi.on('tool_result', (event) => { globalThis.__patchSeen(event.result.summary); return { summary: '乙' } })
    }`)
    await initExtensions({ dirs: [tempRoot] })
    const outcome = await emit('tool_result', { toolCallId: 'tc-1', toolName: 'some_tool', args: {}, result: { summary: '原', ok: true }, isError: false }, {})
    delete globalThis.__patchSeen
    expect(outcome.summary).toBe('乙')
    expect(seen.mock.calls).toEqual([['甲']])
  })

  it('一般事件 handler 抛错不影响后续 handler；tool_call 抛错 fail-safe 阻断', async () => {
    mkdirSync(path.join(tempRoot, 'later'), { recursive: true })
    writeFileSync(path.join(tempRoot, 'later', 'index.js'), `export default (pi) => {
      pi.on('input', (event) => ({ action: 'transform', text: event.text + '后' }))
    }`)
    await initExtensions({ dirs: [FIXTURE_EXTENSIONS, path.join(tempRoot, 'later')] })
    // throwing-handler 先注册的 input 抛错，后面的 handler 仍然拿到并改写文本
    expect(await emit('input', { text: '前' }, {})).toBe('前后')
    const blocked = await emit('tool_call', { toolCallId: 'tc-1', toolName: 'other_tool', args: {} }, {})
    expect(blocked).toEqual({ block: true, reason: '扩展执行出错，安全起见先拦下这个动作', terminate: undefined })
  })
})

describe('extensionRuntime 生命周期与技能贡献', () => {
  let tempRoot
  beforeEach(async () => {
    vi.clearAllMocks()
    resetSkillCatalog()
    await shutdownExtensions()
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'amie-ext-'))
  })
  afterEach(async () => {
    await shutdownExtensions()
    resetSkillCatalog()
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('registerSkillPath 与 resources_discover 的路径进技能目录，session 生命周期按序到达', async () => {
    const skillsDir = path.join(tempRoot, 'skills')
    mkdirSync(path.join(skillsDir, 'demo'), { recursive: true })
    writeFileSync(path.join(skillsDir, 'demo', 'SKILL.md'), '---\ndescription: 扩展贡献的技能\n---\n演示正文\n')
    globalThis.__lifecycle = []
    writeFileSync(path.join(tempRoot, 'skills-ext.js'), `export default (pi) => {
      pi.registerSkillPath(${JSON.stringify(skillsDir)})
      pi.on('resources_discover', () => ({ skillPaths: [${JSON.stringify(skillsDir)}] }))
      pi.on('session_start', () => { globalThis.__lifecycle.push('start') })
      pi.on('session_shutdown', () => { globalThis.__lifecycle.push('shutdown') })
    }`)
    await initExtensions({ dirs: [tempRoot] })
    expect(getSkill('demo')).toMatchObject({ description: '扩展贡献的技能', sourceRank: 2 })
    expect(globalThis.__lifecycle).toEqual(['start'])
    await shutdownExtensions()
    await shutdownExtensions()
    // 幂等：session_shutdown 只发一次
    expect(globalThis.__lifecycle).toEqual(['start', 'shutdown'])
    delete globalThis.__lifecycle
  })

  it('session_shutdown 广播一次后清空注册表', async () => {
    globalThis.__shutdowns = 0
    writeFileSync(path.join(tempRoot, 'down.js'), `export default (pi) => {
      pi.on('session_shutdown', () => { globalThis.__shutdowns += 1 })
    }`)
    await initExtensions({ dirs: [tempRoot] })
    await shutdownExtensions()
    await shutdownExtensions()
    expect(globalThis.__shutdowns).toBe(1)
    expect(extensionTools()).toEqual({})
    delete globalThis.__shutdowns
  })
})

describe('扩展工具经 executeToolCall 的确认卡与拦截', () => {
  let tempRoot
  beforeEach(async () => {
    vi.clearAllMocks()
    resetSkillCatalog()
    await shutdownExtensions()
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'amie-ext-'))
  })
  afterEach(async () => {
    await shutdownExtensions()
    resetSkillCatalog()
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('无 readOnly 的扩展工具默认进确认卡：pending 提案，不执行 run', async () => {
    // 只装 hello-tool：整套夹具里的 throwing-handler 会 fail-safe 拦下一切 tool_call
    cpSync(path.join(FIXTURE_EXTENSIONS, 'hello-tool.js'), path.join(tempRoot, 'hello-tool.js'))
    await initExtensions({ dirs: [tempRoot] })
    const run = await executeToolCall('u1', { name: 'hello_write', args: {} }, { conversationId: 'c1' })
    expect(run).toMatchObject({ tool: 'hello_write', ok: true, pending: true, args: {}, summary: '想执行「hello_write」，等你点头' })
    expect(run.feedback).toContain('"pending":true')
  })

  it('guard-tool 拦下 delete_diary：ok false 与 blocked feedback，动作没有执行', async () => {
    await initExtensions({ dirs: [FIXTURE_EXTENSIONS] })
    const run = await executeToolCall('u1', { name: 'delete_diary', args: { id: 'd1' } }, { conversationId: 'c1' })
    expect(run).toMatchObject({ tool: 'delete_diary', ok: false, summary: '这个动作被拦下了' })
    expect(JSON.parse(run.feedback.replace('工具执行结果：', '').split('（')[0])).toEqual({
      tool: 'delete_diary', ok: false, blocked: true, reason: '演示守卫拦下了删手记',
    })
  })

  it('readOnly 扩展工具直接执行，toolCallId 透传给 execute', async () => {
    cpSync(path.join(FIXTURE_EXTENSIONS, 'hello-tool.js'), path.join(tempRoot, 'hello-tool.js'))
    await initExtensions({ dirs: [tempRoot] })
    const run = await executeToolCall('u1', { name: 'hello_tool', args: { name: 'Amie' } }, { conversationId: 'c1', toolCallId: 'tc-9' })
    expect(run).toMatchObject({ tool: 'hello_tool', ok: true, summary: '打了个招呼', result: { toolCallId: 'tc-9', text: 'hi Amie' } })
    expect(run.feedback).toContain('hi Amie')
  })

  it('确认卡点头后的执行同样过 tool_call 拦截', async () => {
    await initExtensions({ dirs: [FIXTURE_EXTENSIONS] })
    await expect(runConfirmedTool('u1', 'delete_diary', { id: 'd1' })).resolves.toMatchObject({
      ok: false,
      summary: '这个动作被拦下了',
      result: { blocked: true, reason: '演示守卫拦下了删手记' },
    })
  })
})
