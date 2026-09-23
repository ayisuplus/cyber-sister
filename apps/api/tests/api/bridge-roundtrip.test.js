import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// 真实的 HTTP 往返：服务端的本机助手路由 + 仓库里的助手客户端（apps/bridge），只把数据库换成内存假件。
const TOKEN = 'roundtrip-token-0123456789abcdefghijklmnop'
vi.mock('../../src/prisma/client.js', () => ({
  default: {
    localBridge: {
      findFirst: vi.fn(async ({ where }) => (where.revokedAt === null ? { id: 'bridge-rt', userId: 'user-rt', name: '测试电脑', lastSeenAt: null } : null)),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  },
}))
vi.mock('../../src/services/bridgeService.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, authenticateBridge: async (token) => (token === TOKEN ? { id: 'bridge-rt', userId: 'user-rt', name: '测试电脑', lastSeenAt: null } : null) }
})

import bridgeRoutes from '../../src/routes/bridge.js'
import { executeToolCall } from '../../src/services/agentService.js'
import { isUserBridgeOnline, resetBridgeBroker } from '../../src/services/bridgeBroker.js'
import { runBridge } from '../../../bridge/src/client.js'

let server
let origin
let folder
const controller = new AbortController()
let running

beforeAll(async () => {
  folder = await mkdtemp(path.join(tmpdir(), 'amie-roundtrip-'))
  await writeFile(path.join(folder, '周末计划.md'), '周六去爬山，周日看书')
  const app = express()
  app.use(express.json())
  app.use('/api/bridge', bridgeRoutes)
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve) })
  origin = `http://127.0.0.1:${server.address().port}`
  running = runBridge({ server: origin, token: TOKEN, folder, log: () => {}, signal: controller.signal })
})

afterAll(async () => {
  controller.abort()
  resetBridgeBroker()
  await running
  await new Promise((resolve) => server.close(resolve))
  await rm(folder, { recursive: true, force: true })
})

describe('本机助手真实往返', () => {
  it('她经助手看目录、读文件、新建文件；越界与覆盖在用户电脑上被拒绝', async () => {
    await vi.waitFor(() => expect(isUserBridgeOnline('user-rt')).toBe(true))

    const listed = await executeToolCall('user-rt', { name: 'list_local_files', args: {} })
    expect(listed).toMatchObject({ ok: true, summary: '看了「授权文件夹」里的 1 项' })
    expect(listed.feedback).toContain('周末计划.md')

    const read = await executeToolCall('user-rt', { name: 'read_local_file', args: { path: '周末计划.md' } })
    expect(read.ok).toBe(true)
    expect(read.feedback).toContain('周六去爬山')

    const written = await executeToolCall('user-rt', { name: 'write_local_file', args: { path: '清单/买菜.md', content: '青菜、豆腐' } })
    expect(written).toMatchObject({ ok: true, summary: '在你的电脑上新建了「清单/买菜.md」' })
    expect(await readFile(path.join(folder, '清单', '买菜.md'), 'utf8')).toBe('青菜、豆腐')

    const overwrite = await executeToolCall('user-rt', { name: 'write_local_file', args: { path: '周末计划.md', content: '改掉' } })
    expect(overwrite).toMatchObject({ ok: false, summary: '同名文件已存在，没有覆盖' })
    expect(await readFile(path.join(folder, '周末计划.md'), 'utf8')).toBe('周六去爬山，周日看书')

    const escape = await executeToolCall('user-rt', { name: 'read_local_file', args: { path: '../../etc/passwd' } })
    expect(escape).toMatchObject({ ok: false, summary: '不能访问授权文件夹以外的地方' })
  }, 20000)
})
