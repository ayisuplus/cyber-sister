import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn: spawnMock }))
import { reapWorkContainers, runWorkPython, startWorkContainerReaper, stopWorkContainerReaper, workCodeStatus } from './workExecutionService.js'

const env = { WORK_CODE_ENABLED: 'true' }
const result = { exitCode: 0, stdout: '42', stderr: '', files: [] }
const containerId = 'a'.repeat(64)
function childProcess(onInput) {
  const child = new EventEmitter()
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn()
  let input = ''
  child.stdin.on('data', (chunk) => { input += chunk })
  child.stdin.on('finish', () => onInput(child, input))
  return child
}

describe('隔离代码执行生命周期', () => {
  beforeEach(() => vi.resetAllMocks())
  afterEach(async () => {
    await stopWorkContainerReaper()
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })
  it('未启用时不启动 Docker，也不使用主机 Python 回退', async () => {
    await expect(runWorkPython('u1', { code: 'print(42)' }, { env: {} })).rejects.toMatchObject({ statusCode: 503 })
    expect(await workCodeStatus({})).toEqual({ enabled: false, available: false })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('代码只进入 stdin；创建受限容器，结束后先清理再返回', async () => {
    const calls = []
    spawnMock.mockImplementation((command, args, options) => childProcess((child, input) => {
      calls.push({ command, args, options, input })
      if (args[0] === 'create') child.stdout.write(containerId)
      if (args[0] === 'start') child.stdout.write(JSON.stringify(result))
      child.emit('close', 0)
    }))
    expect(await runWorkPython('u1', { code: 'print(42)' }, { env })).toMatchObject(result)
    expect(calls.map((call) => call.args[0])).toEqual(['create', 'start', 'rm'])
    expect(calls[0].args).toEqual(expect.arrayContaining(['--network', 'none', '--read-only', '--cap-drop', 'ALL', '--memory', '512m']))
    expect(calls[0].args).toEqual(expect.arrayContaining(['--rm', '--label', 'app.amie.sandbox=python-v1']))
    const expiry = calls[0].args.find((arg) => arg.startsWith('app.amie.expires-at='))
    expect(Number(expiry.split('=')[1])).toBeGreaterThan(Date.now() + 110000)
    expect(calls[0].args).not.toContain('-v')
    expect(calls[0].args).not.toContain('print(42)')
    expect(calls[0].options.windowsHide).toBe(true)
    expect(JSON.parse(calls[1].input)).toEqual({ code: 'print(42)', files: [] })
    expect(calls[2].args).toEqual(['rm', '-f', containerId])
  })

  it('创建期间取消：晚到的容器会被删除，永远不启动代码', async () => {
    const controller = new AbortController()
    const commands = []
    spawnMock.mockImplementation((_command, args) => childProcess((child) => {
      commands.push(args[0])
      if (args[0] === 'create') { child.stdout.write(containerId); controller.abort() }
      child.emit('close', 0)
    }))
    await expect(runWorkPython('u1', { code: 'print(42)' }, { env, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(commands).toEqual(['create', 'rm'])
  })

  it('运行中取消：等待强制删除，丢弃迟到输出', async () => {
    const controller = new AbortController()
    const commands = []
    spawnMock.mockImplementation((_command, args) => childProcess((child) => {
      commands.push(args[0])
      if (args[0] === 'create') child.stdout.write(containerId)
      if (args[0] === 'start') {
        controller.abort()
        child.stdout.write(JSON.stringify(result))
      }
      child.emit('close', 0)
    }))
    await expect(runWorkPython('u1', { code: 'print(42)' }, { env, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(commands).toEqual(['create', 'start', 'rm'])
  })

  it('容器清理失败不能报告任务成功，驱动错误不泄漏宿主细节', async () => {
    spawnMock.mockImplementation((_command, args) => childProcess((child) => {
      if (args[0] === 'create' || args[0] === 'ps') child.stdout.write(containerId)
      if (args[0] === 'start') child.stdout.write(JSON.stringify(result))
      if (args[0] === 'rm') child.stderr.write('host secret diagnostic')
      child.emit('close', args[0] === 'rm' ? 1 : 0)
    }))
    await expect(runWorkPython('u1', { code: 'print(42)' }, { env })).rejects.toMatchObject({ statusCode: 503, message: '隔离执行环境暂时不可用' })
  })

  it('Docker 已自动回收时，核实容器不存在后允许交付', async () => {
    spawnMock.mockImplementation((_command, args) => childProcess((child) => {
      if (args[0] === 'create') child.stdout.write(containerId)
      if (args[0] === 'start') child.stdout.write(JSON.stringify(result))
      child.emit('close', args[0] === 'rm' ? 1 : 0)
    }))
    expect(await runWorkPython('u1', { code: 'print(42)' }, { env })).toMatchObject(result)
    expect(spawnMock.mock.calls.at(-1)[1]).toEqual(['ps', '-a', '--no-trunc', '--filter', `id=${containerId}`, '--format', '{{.ID}}'])
  })

  it('回收后的存在性查询失败，不能把未知状态当作已删除', async () => {
    spawnMock.mockImplementation((_command, args) => childProcess((child) => {
      if (args[0] === 'create') child.stdout.write(containerId)
      if (args[0] === 'start') child.stdout.write(JSON.stringify(result))
      child.emit('close', ['rm', 'ps'].includes(args[0]) ? 1 : 0)
    }))
    await expect(runWorkPython('u1', { code: 'print(42)' }, { env })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('在清理等待期间取消，最终也不返回生成结果', async () => {
    const controller = new AbortController()
    spawnMock.mockImplementation((_command, args) => childProcess((child) => {
      if (args[0] === 'create') child.stdout.write(containerId)
      if (args[0] === 'start') child.stdout.write(JSON.stringify(result))
      if (args[0] === 'rm') controller.abort()
      child.emit('close', 0)
    }))
    await expect(runWorkPython('u1', { code: 'print(42)' }, { env, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('启动前已超过绝对到期时间，休眠恢复后也不能启动过期容器', async () => {
    vi.useFakeTimers()
    spawnMock.mockImplementation((_command, args) => childProcess((child) => {
      if (args[0] === 'create') { child.stdout.write(containerId); vi.setSystemTime(Date.now() + 121000) }
      child.emit('close', 0)
    }))
    await expect(runWorkPython('u1', { code: 'print(42)' }, { env })).rejects.toMatchObject({ statusCode: 503 })
    expect(spawnMock.mock.calls.map((call) => call[1][0])).toEqual(['create', 'rm'])
  })

  it('只清理由专属标签筛出的到期容器；保留有效、缺失或畸形的到期标记', async () => {
    const output = [`${containerId} ${Date.now() - 1}`, `${'b'.repeat(64)} ${Date.now() + 60000}`,
      `${'c'.repeat(64)} <no value>`, `${'d'.repeat(64)} NaN`, `--all ${Date.now() - 1}`].join('\n')
    spawnMock.mockImplementation((_command, args) => childProcess((child) => {
      if (args[0] === 'ps') child.stdout.write(output)
      child.emit('close', 0)
    }))
    expect(await reapWorkContainers(env)).toBe(1)
    expect(spawnMock.mock.calls[0][1]).toEqual(['ps', '-a', '--no-trunc', '--filter', 'label=app.amie.sandbox=python-v1', '--format', '{{.ID}} {{.Label "app.amie.expires-at"}}'])
    expect(spawnMock.mock.calls.slice(1).map((call) => call[1])).toEqual([['rm', '-f', containerId]])
  })

  it('未启用代码时不启动回收进程', async () => {
    vi.stubEnv('WORK_CODE_ENABLED', 'false')
    startWorkContainerReaper()
    expect(await reapWorkContainers({})).toBe(0)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('启动立即回收，重复启动不增加轮询，停机等待当前查询后停止轮询', async () => {
    vi.useFakeTimers()
    vi.stubEnv('WORK_CODE_ENABLED', 'true')
    let pending
    spawnMock.mockImplementation(() => childProcess((child) => { pending = child }))
    startWorkContainerReaper()
    startWorkContainerReaper()
    await vi.advanceTimersByTimeAsync(1)
    expect(spawnMock).toHaveBeenCalledTimes(1)
    pending.emit('close', 0)
    await vi.advanceTimersByTimeAsync(30000)
    expect(spawnMock).toHaveBeenCalledTimes(2)
    const stopped = vi.fn()
    const stopping = stopWorkContainerReaper().then(stopped)
    await Promise.resolve()
    expect(stopped).not.toHaveBeenCalled()
    pending.emit('close', 0)
    await stopping
    await vi.advanceTimersByTimeAsync(60000)
    expect(spawnMock).toHaveBeenCalledTimes(2)
  })
})
