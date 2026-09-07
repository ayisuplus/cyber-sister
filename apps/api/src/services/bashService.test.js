import { describe, expect, it, vi } from 'vitest'

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { runBash } from './bashService.js'

const ENABLED = { BASH_ENABLED: 'true' }
// node 自身当跨平台 sleep/打印器，避免依赖 cmd/sh 内建命令差异
const NODE = JSON.stringify(process.execPath)

describe('bashService.runBash', () => {
  it('BASH_ENABLED 未开启 → 503 本机终端未启用', async () => {
    await expect(runBash('u1', 'echo hi', { env: {} }))
      .rejects.toMatchObject({ statusCode: 503, message: '本机终端未启用' })
  })

  it('空命令 → 400 命令不能为空', async () => {
    await expect(runBash('u1', '   ', { env: ENABLED }))
      .rejects.toMatchObject({ statusCode: 400, message: '命令不能为空' })
    await expect(runBash('u1', null, { env: ENABLED }))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('成功命令：exitCode 0 且 stdout 带回输出', async () => {
    const result = await runBash('u1', `${NODE} -e "console.log('hello-bash')"`, { env: ENABLED })
    expect(result).toMatchObject({ exitCode: 0, timedOut: false })
    expect(result.stdout).toContain('hello-bash')
  })

  it('非零退出不抛异常：如实带回 exitCode 与 stderr', async () => {
    const result = await runBash('u1', `${NODE} -e "console.error('boom');process.exit(3)"`, { env: ENABLED })
    expect(result).toMatchObject({ exitCode: 3, timedOut: false })
    expect(result.stderr).toContain('boom')
  })

  it('超时即终止：timedOut 为真且不等待命令跑完', async () => {
    const started = Date.now()
    const result = await runBash('u1', `${NODE} -e "setTimeout(()=>{},10000)"`, { env: ENABLED, timeoutMs: 300 })
    expect(Date.now() - started).toBeLessThan(5000)
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBe(-1)
  })

  it('超长输出截断到 4000 字符并带截断标记', async () => {
    const result = await runBash('u1', `${NODE} -e "console.log('x'.repeat(9000))"`, { env: ENABLED })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.length).toBeLessThanOrEqual(4000 + 20)
    expect(result.stdout).toContain('输出过长已截断')
  })
})
