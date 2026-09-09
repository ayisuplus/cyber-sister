import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const service = vi.hoisted(() => ({
  listInsights: vi.fn(),
  analyzeNow: vi.fn(),
  promoteInsight: vi.fn(),
  resolveInsight: vi.fn(),
  rebuildInsights: vi.fn(),
  dismissInsight: vi.fn(),
  clearInsights: vi.fn(),
}))

const edgeSvc = vi.hoisted(() => ({
  listEdges: vi.fn(),
  promoteEdge: vi.fn(),
  dismissEdge: vi.fn(),
}))

vi.mock('../services/derivedService.js', () => service)
vi.mock('../services/edgeService.js', () => edgeSvc)
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import derivedRoutes from './derived.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', derivedRoutes)

beforeEach(() => vi.clearAllMocks())

describe('工作台路由', () => {
  it('GET / 返回条目列表并透传 status 过滤，非法 status 透传 400 文案', async () => {
    service.listInsights.mockResolvedValue([{ id: 'i1' }])
    const ok = await request(app).get('/?status=all')
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ insights: [{ id: 'i1' }] })
    expect(service.listInsights).toHaveBeenCalledWith('user-1', { status: 'all' })

    service.listInsights.mockRejectedValue(
      Object.assign(new Error('status 必须是 active、promoted、dismissed 或 all'), { statusCode: 400 }),
    )
    const bad = await request(app).get('/?status=bogus')
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: 'status 必须是 active、promoted、dismissed 或 all' })
  })

  it('POST /analyze 返回计数，同意门与模型不可用按 503 + code 原样透传', async () => {
    service.analyzeNow.mockResolvedValue({ created: 2, skipped: 1 })
    const ok = await request(app).post('/analyze')
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ created: 2, skipped: 1 })
    expect(service.analyzeNow).toHaveBeenCalledWith('user-1', undefined)

    service.analyzeNow.mockRejectedValue(Object.assign(new Error('需要你先同意使用云端模型才能聊天'), {
      code: 'CLOUD_NOT_CONSENTED',
      statusCode: 503,
    }))
    const noConsent = await request(app).post('/analyze')
    expect(noConsent.status).toBe(503)
    expect(noConsent.body).toEqual({ error: '需要你先同意使用云端模型才能聊天', code: 'CLOUD_NOT_CONSENTED' })

    service.analyzeNow.mockRejectedValue(Object.assign(new Error('外部模型暂时不可用，请稍后重试'), {
      code: 'LLM_UNAVAILABLE',
      statusCode: 503,
    }))
    const unavailable = await request(app).post('/analyze')
    expect(unavailable.status).toBe(503)
    expect(unavailable.body).toEqual({ error: '外部模型暂时不可用，请稍后重试', code: 'LLM_UNAVAILABLE' })
  })

  it('POST /:id/promote 返回记忆与条目，404 与 400 校验文案透传', async () => {
    service.promoteInsight.mockResolvedValue({ memory: { id: 'm1' }, insight: { id: 'i1', status: 'promoted' } })
    const ok = await request(app).post('/i1/promote').send({ type: 'episodic', importance: 8, tags: ['工作'] })
    expect(ok.status).toBe(200)
    expect(ok.body.insight.status).toBe('promoted')
    expect(service.promoteInsight).toHaveBeenCalledWith('user-1', 'i1', { type: 'episodic', importance: 8, tags: ['工作'] })

    service.promoteInsight.mockRejectedValue(Object.assign(new Error('工作台条目不存在'), { statusCode: 404 }))
    const missing = await request(app).post('/nope/promote').send({})
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: '工作台条目不存在' })

    service.promoteInsight.mockRejectedValue(
      Object.assign(new Error('记忆类型必须是以下值之一: semantic, episodic, procedural'), { statusCode: 400 }),
    )
    const invalid = await request(app).post('/i1/promote').send({ type: 'wild' })
    expect(invalid.status).toBe(400)
    expect(invalid.body).toEqual({ error: '记忆类型必须是以下值之一: semantic, episodic, procedural' })
  })

  it('POST /:id/dismiss 返回 success，非本人条目 404', async () => {
    service.dismissInsight.mockResolvedValue(undefined)
    const ok = await request(app).post('/i1/dismiss')
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ success: true })
    expect(service.dismissInsight).toHaveBeenCalledWith('user-1', 'i1')

    service.dismissInsight.mockRejectedValue(Object.assign(new Error('工作台条目不存在'), { statusCode: 404 }))
    const missing = await request(app).post('/nope/dismiss')
    expect(missing.status).toBe(404)
  })

  it('DELETE / 返回清空计数', async () => {
    service.clearInsights.mockResolvedValue(4)
    const ok = await request(app).delete('/')
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ cleared: 4 })
    expect(service.clearInsights).toHaveBeenCalledWith('user-1')
  })

  it('POST /rebuild 返回清删与新增计数，同意门带 code 透传', async () => {
    service.rebuildInsights.mockResolvedValue({ cleared: 2, created: 1, skipped: 0 })
    const ok = await request(app).post('/rebuild')
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ cleared: 2, created: 1, skipped: 0 })
    expect(service.rebuildInsights).toHaveBeenCalledWith('user-1', undefined)

    service.rebuildInsights.mockRejectedValue(Object.assign(new Error('需要你先同意使用云端模型才能聊天'), {
      code: 'CLOUD_NOT_CONSENTED',
      statusCode: 503,
    }))
    const noConsent = await request(app).post('/rebuild')
    expect(noConsent.status).toBe(503)
    expect(noConsent.body).toEqual({ error: '需要你先同意使用云端模型才能聊天', code: 'CLOUD_NOT_CONSENTED' })
  })

  it('POST /:id/resolve 透传定稿参数，400 与 404 文案透传', async () => {
    service.resolveInsight.mockResolvedValue({ memory: { id: 'm1' }, insight: { id: 'i1', status: 'resolved' } })
    const ok = await request(app).post('/i1/resolve').send({ content: '她想要独立书房', type: 'semantic', importance: 8, tags: ['生活'] })
    expect(ok.status).toBe(200)
    expect(ok.body.insight.status).toBe('resolved')
    expect(service.resolveInsight).toHaveBeenCalledWith('user-1', 'i1', { content: '她想要独立书房', type: 'semantic', importance: 8, tags: ['生活'] })

    service.resolveInsight.mockRejectedValue(Object.assign(new Error('只有冲突条目需要厘清'), { statusCode: 400 }))
    const invalid = await request(app).post('/i1/resolve').send({ content: 'x' })
    expect(invalid.status).toBe(400)
    expect(invalid.body).toEqual({ error: '只有冲突条目需要厘清' })

    service.resolveInsight.mockRejectedValue(Object.assign(new Error('工作台条目不存在'), { statusCode: 404 }))
    const missing = await request(app).post('/nope/resolve').send({ content: 'x' })
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: '工作台条目不存在' })
  })
})

describe('记忆关系边路由（M2）', () => {
  it('GET /edges 透传 status 过滤，非法 status 透传 400 文案', async () => {
    edgeSvc.listEdges.mockResolvedValue([{ id: 'e1', status: 'derived' }])
    const ok = await request(app).get('/edges?status=all')
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ edges: [{ id: 'e1', status: 'derived' }] })
    expect(edgeSvc.listEdges).toHaveBeenCalledWith('user-1', { status: 'all' })

    await request(app).get('/edges')
    expect(edgeSvc.listEdges).toHaveBeenLastCalledWith('user-1', { status: undefined })

    edgeSvc.listEdges.mockRejectedValue(
      Object.assign(new Error('status 必须是 derived、canonical、dismissed 或 all'), { statusCode: 400 }),
    )
    const bad = await request(app).get('/edges?status=bogus')
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: 'status 必须是 derived、canonical、dismissed 或 all' })
  })

  it('POST /edges/:id/promote 返回单条，404/400 透传且不触达 insight 晋升', async () => {
    edgeSvc.promoteEdge.mockResolvedValue({ id: 'e1', status: 'canonical' })
    const ok = await request(app).post('/edges/e1/promote')
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ edge: { id: 'e1', status: 'canonical' } })
    expect(edgeSvc.promoteEdge).toHaveBeenCalledWith('user-1', 'e1')
    expect(service.promoteInsight).not.toHaveBeenCalled()

    edgeSvc.promoteEdge.mockRejectedValue(Object.assign(new Error('记忆关系不存在'), { statusCode: 404 }))
    const missing = await request(app).post('/edges/nope/promote')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: '记忆关系不存在' })

    edgeSvc.promoteEdge.mockRejectedValue(Object.assign(new Error('该关系已确认'), { statusCode: 400 }))
    const duplicated = await request(app).post('/edges/e1/promote')
    expect(duplicated.status).toBe(400)
    expect(duplicated.body).toEqual({ error: '该关系已确认' })
  })

  it('POST /edges/:id/dismiss 返回 success，404 透传', async () => {
    edgeSvc.dismissEdge.mockResolvedValue(undefined)
    const ok = await request(app).post('/edges/e1/dismiss')
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ success: true })
    expect(edgeSvc.dismissEdge).toHaveBeenCalledWith('user-1', 'e1')
    expect(service.dismissInsight).not.toHaveBeenCalled()

    edgeSvc.dismissEdge.mockRejectedValue(Object.assign(new Error('记忆关系不存在'), { statusCode: 404 }))
    const missing = await request(app).post('/edges/nope/dismiss')
    expect(missing.status).toBe(404)
  })
})
