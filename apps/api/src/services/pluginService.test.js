import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { loadPlugins } from './pluginService.js'

const VALID_PLUGIN = `export default {
  name: 'say_hi',
  description: '{"tool":"say_hi","args":{"who":"可选 名字"}} 示例插件：打招呼',
  run: async (userId, args) => ({ summary: '已打招呼', result: { hello: String(args.who ?? '朋友') } }),
}`

describe('pluginService', () => {
  let dir
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'plugins-'))
    process.env.PLUGINS_DIR = dir
  })
  afterEach(() => {
    delete process.env.PLUGINS_ENABLED
    delete process.env.PLUGINS_DIR
    rmSync(dir, { recursive: true, force: true })
  })

  it('未启用时不注册任何插件', async () => {
    writeFileSync(join(dir, 'hello.js'), VALID_PLUGIN)
    const register = vi.fn()
    const loaded = await loadPlugins(register)
    expect(loaded).toEqual([])
    expect(register).not.toHaveBeenCalled()
  })

  it('目录不存在时返回空', async () => {
    process.env.PLUGINS_ENABLED = 'true'
    process.env.PLUGINS_DIR = join(dir, 'missing')
    const register = vi.fn()
    expect(await loadPlugins(register)).toEqual([])
    expect(register).not.toHaveBeenCalled()
  })

  it('合法插件注册成功，run 原样透传 summary/result', async () => {
    process.env.PLUGINS_ENABLED = 'true'
    writeFileSync(join(dir, 'hello.js'), VALID_PLUGIN)
    const register = vi.fn(() => true)
    const loaded = await loadPlugins(register)
    expect(loaded).toEqual(['say_hi'])
    expect(register).toHaveBeenCalledOnce()
    const [name, tool] = register.mock.calls[0]
    expect(name).toBe('say_hi')
    expect(tool.description).toContain('"tool":"say_hi"')
    await expect(tool.run('u1', { who: '小明' })).resolves.toEqual({ summary: '已打招呼', result: { hello: '小明' } })
  })

  it('wrapped 兜底缺省 summary 与 result', async () => {
    process.env.PLUGINS_ENABLED = 'true'
    writeFileSync(join(dir, 'bare.js'), `export default {
      name: 'bare_run',
      description: '{"tool":"bare_run","args":{}}',
      run: async () => undefined,
    }`)
    const register = vi.fn(() => true)
    await loadPlugins(register)
    const [, tool] = register.mock.calls[0]
    await expect(tool.run('u1', {})).resolves.toEqual({ summary: '已执行「bare_run」', result: null })
  })

  it('插件抛错原样上抛', async () => {
    process.env.PLUGINS_ENABLED = 'true'
    writeFileSync(join(dir, 'boom.js'), `export default {
      name: 'boom_run',
      description: '{"tool":"boom_run","args":{}}',
      run: async () => { throw new Error('插件内部错误') },
    }`)
    const register = vi.fn(() => true)
    await loadPlugins(register)
    const [, tool] = register.mock.calls[0]
    await expect(tool.run('u1', {})).rejects.toThrow('插件内部错误')
  })

  it('name 非法 / description 前缀不符 / run 缺失的插件跳过', async () => {
    process.env.PLUGINS_ENABLED = 'true'
    writeFileSync(join(dir, 'bad-name.js'), `export default {
      name: 'Bad-Name',
      description: '{"tool":"Bad-Name","args":{}}',
      run: async () => ({}),
    }`)
    writeFileSync(join(dir, 'bad-desc.js'), `export default {
      name: 'bad_desc',
      description: '没有工具 JSON 前缀',
      run: async () => ({}),
    }`)
    writeFileSync(join(dir, 'no-run.js'), `export default {
      name: 'no_run',
      description: '{"tool":"no_run","args":{}}',
    }`)
    writeFileSync(join(dir, 'not-object.js'), 'export default 42')
    writeFileSync(join(dir, 'good.js'), VALID_PLUGIN.replaceAll('say_hi', 'good_one'))
    const register = vi.fn(() => true)
    const loaded = await loadPlugins(register)
    expect(loaded).toEqual(['good_one'])
    expect(register).toHaveBeenCalledOnce()
  })

  it('register 返回 false（重名）时插件不进入成功列表但仍算已处理', async () => {
    process.env.PLUGINS_ENABLED = 'true'
    writeFileSync(join(dir, 'hello.js'), VALID_PLUGIN)
    const register = vi.fn(() => false)
    const loaded = await loadPlugins(register)
    expect(register).toHaveBeenCalledOnce()
    expect(loaded).toEqual(['say_hi'])
  })
})
