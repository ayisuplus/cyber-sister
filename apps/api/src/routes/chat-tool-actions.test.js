import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
/* global structuredClone */

// 聊天内确认卡的两条端点：点头执行（复用工具自己的 run）/「不用」标记没做。
// 这里走真实的 runConfirmedTool → delete_diary 的 run → diaryService（mock），
// 证明确认端点与聊天回合共用同一执行通道。
const db = vi.hoisted(() => ({
  messageFindFirst: vi.fn(),
  messageUpdateMany: vi.fn(),
}))
const diary = vi.hoisted(() => ({ deleteEntry: vi.fn() }))

vi.mock('../prisma/client.js', () => ({
  default: {
    message: { findFirst: db.messageFindFirst, updateMany: db.messageUpdateMany },
  },
}))
vi.mock('../services/diaryService.js', () => diary)
vi.mock('../services/chatService.js', () => ({}))
vi.mock('../services/nudgeService.js', () => ({}))
vi.mock('../services/openerService.js', () => ({}))
vi.mock('../services/chatImageService.js', () => ({ readChatImage: vi.fn() }))
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import chatRoutes from './chat.js'
import { initExtensions, shutdownExtensions } from '../services/extensionRuntime.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', chatRoutes)

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode })

const pendingRun = { tool: 'delete_diary', ok: true, pending: true, args: { day: '2026-09-22' }, summary: '想删掉 2026-09-22 的手记，等你点头' }
let storedRuns
const fixture = (toolRuns) => { storedRuns = toolRuns }

beforeEach(() => {
  vi.clearAllMocks()
  storedRuns = null
  db.messageFindFirst.mockImplementation(() => Promise.resolve(storedRuns === null ? null : { id: 'm1', toolRuns: structuredClone(storedRuns) }))
  db.messageUpdateMany.mockImplementation(({ where, data }) => {
    if (JSON.stringify(where.toolRuns.equals) !== JSON.stringify(storedRuns)) return Promise.resolve({ count: 0 })
    storedRuns = structuredClone(data.toolRuns)
    return Promise.resolve({ count: 1 })
  })
})

describe('POST /messages/:messageId/tool-runs/:index/confirm', () => {
  it('点头后执行同一个 run 并把结果写回 toolRun', async () => {
    fixture([pendingRun])
    diary.deleteEntry.mockResolvedValue(undefined)

    const res = await request(app).post('/messages/m1/tool-runs/0/confirm')

    expect(res.status).toBe(200)
    expect(diary.deleteEntry).toHaveBeenCalledWith('user-1', '2026-09-22')
    expect(res.body.toolRun).toEqual({ tool: 'delete_diary', ok: true, summary: '已删掉 2026-09-22 的手记' })
    expect(storedRuns).toEqual([{ tool: 'delete_diary', ok: true, summary: '已删掉 2026-09-22 的手记' }])
    expect(db.messageUpdateMany).toHaveBeenCalledTimes(2)
  })

  it('执行对象已经不在了：照样清掉提案，返回 already 与「已经不在了」', async () => {
    fixture([pendingRun])
    diary.deleteEntry.mockRejectedValue(httpError('这一天还没有日记', 404))

    const res = await request(app).post('/messages/m1/tool-runs/0/confirm')

    expect(res.status).toBe(200)
    expect(res.body.already).toBe(true)
    expect(res.body.toolRun).toEqual({ tool: 'delete_diary', ok: true, summary: '已经不在了' })
    expect(storedRuns).toEqual([{ tool: 'delete_diary', ok: true, summary: '已经不在了' }])
  })

  it('提案已处理再 confirm → 409「这个动作已经处理过了」', async () => {
    fixture([{ tool: 'delete_diary', ok: true, summary: '已删掉 2026-09-22 的手记' }])

    const res = await request(app).post('/messages/m1/tool-runs/0/confirm')

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: '这个动作已经处理过了' })
    expect(diary.deleteEntry).not.toHaveBeenCalled()
    expect(db.messageUpdateMany).not.toHaveBeenCalled()
  })

  it.each([['9'], ['-1'], ['1.5'], ['1']])('下标 %s 非法或越界 → 404「这个动作已经不在了」', async (index) => {
    fixture([pendingRun])

    const res = await request(app).post(`/messages/m1/tool-runs/${index}/confirm`)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: '这个动作已经不在了' })
  })

  it('非本人消息一律 404「消息不存在」', async () => {
    db.messageFindFirst.mockResolvedValue(null)

    const res = await request(app).post('/messages/m1/tool-runs/0/confirm')

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: '消息不存在' })
    expect(db.messageFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'm1', conversation: { userId: 'user-1' } },
    }))
    expect(diary.deleteEntry).not.toHaveBeenCalled()
  })

  it('执行失败（非 404）如实记录失败，不允许重复执行副作用', async () => {
    fixture([pendingRun])
    diary.deleteEntry.mockRejectedValue(httpError('手记内容不合法', 400))

    const res = await request(app).post('/messages/m1/tool-runs/0/confirm')

    expect(res.status).toBe(200)
    expect(res.body.toolRun).toEqual({ tool: 'delete_diary', ok: false, summary: '手记内容不合法' })
    expect(storedRuns[0].pending).toBeUndefined()
    expect((await request(app).post('/messages/m1/tool-runs/0/confirm')).status).toBe(409)
    expect(diary.deleteEntry).toHaveBeenCalledTimes(1)
  })

  it('扩展拦下确认动作时保留失败结果，不冒称已执行', async () => {
    fixture([pendingRun])
    const root = mkdtempSync(path.join(os.tmpdir(), 'amie-confirm-'))
    try {
      vi.stubEnv('AGENT_EXTENSIONS_ENABLED', 'true')
      writeFileSync(path.join(root, 'block.js'), `export default (pi) => pi.on('tool_call', () => ({ block: true, reason: '需要核对' }))`)
      await initExtensions({ dirs: [root] })
      const res = await request(app).post('/messages/m1/tool-runs/0/confirm')
      expect(res.status).toBe(200)
      expect(res.body.toolRun).toEqual({ tool: 'delete_diary', ok: false, summary: '这个动作被拦下了' })
      expect(storedRuns[0].ok).toBe(false)
      expect(diary.deleteEntry).not.toHaveBeenCalled()
    } finally {
      await shutdownExtensions()
      vi.unstubAllEnvs()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('两个确认并发只执行一次，取消也抢不到已确认提案', async () => {
    fixture([pendingRun])
    let finish
    diary.deleteEntry.mockImplementation(() => new Promise(resolve => { finish = resolve }))

    const first = request(app).post('/messages/m1/tool-runs/0/confirm').then(res => res)
    await vi.waitFor(() => expect(diary.deleteEntry).toHaveBeenCalledTimes(1))
    const [duplicate, dismiss] = await Promise.all([
      request(app).post('/messages/m1/tool-runs/0/confirm'),
      request(app).post('/messages/m1/tool-runs/0/dismiss'),
    ])
    expect(duplicate.status).toBe(409)
    expect(dismiss.status).toBe(409)
    finish()
    expect((await first).status).toBe(200)
    expect(diary.deleteEntry).toHaveBeenCalledTimes(1)
  })
})

describe('POST /messages/:messageId/tool-runs/:index/dismiss', () => {
  it('「不用」把提案标记成没做，不执行', async () => {
    fixture([pendingRun])

    const res = await request(app).post('/messages/m1/tool-runs/0/dismiss')

    expect(res.status).toBe(200)
    expect(res.body.toolRun).toEqual({ tool: 'delete_diary', ok: true, dismissed: true, summary: '你没让做' })
    expect(diary.deleteEntry).not.toHaveBeenCalled()
    expect(storedRuns).toEqual([{ tool: 'delete_diary', ok: true, dismissed: true, summary: '你没让做' }])
  })

  it('重复 dismiss 走同一条 409', async () => {
    fixture([{ tool: 'delete_diary', ok: true, dismissed: true, summary: '你没让做' }])

    const res = await request(app).post('/messages/m1/tool-runs/0/dismiss')

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: '这个动作已经处理过了' })
  })

  it('不同下标的取消并发都保留结果', async () => {
    fixture([pendingRun, { ...pendingRun, args: { day: '2026-09-23' } }])
    const results = await Promise.all([0, 1].map(index => request(app).post(`/messages/m1/tool-runs/${index}/dismiss`)))
    expect(results.map(result => result.status)).toEqual([200, 200])
    expect(storedRuns.every(run => run.dismissed)).toBe(true)
  })
})
