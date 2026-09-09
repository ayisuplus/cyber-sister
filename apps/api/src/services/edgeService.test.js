import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  memoryFindMany: vi.fn(),
  edgeFindMany: vi.fn(),
  edgeFindFirst: vi.fn(),
  edgeCreateMany: vi.fn(),
  edgeUpdate: vi.fn(),
  edgeDeleteMany: vi.fn(),
  getGateway: vi.fn(),
  gatewayComplete: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    memory: { findMany: mocks.memoryFindMany },
    memoryEdge: {
      findMany: mocks.edgeFindMany,
      findFirst: mocks.edgeFindFirst,
      createMany: mocks.edgeCreateMany,
      update: mocks.edgeUpdate,
      deleteMany: mocks.edgeDeleteMany,
    },
  },
}))
// 保留 llmService 的真实错误类，只替换网关装配与同意门前置断言（同 derivedService.test.js 口径）
vi.mock('./llmService.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getGateway: mocks.getGateway,
    assertCloudCallable: (allowExternal) => {
      if (!allowExternal) throw new actual.CloudConsentRequiredError()
    },
  }
})
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  clearDerivedEdges,
  deriveEdges,
  dismissEdge,
  listEdges,
  promoteEdge,
} from './edgeService.js'

const USER_ID = 'user-1'
const REQUEST_ID = 'req-1'
const CONSENT = { allowExternal: true, authorizeExternal: async () => true }
const MEMORIES = [
  { id: 'm1', content: '喜欢火锅' },
  { id: 'm2', content: '每周五吃火锅' },
  { id: 'm3', content: '周五晚上固定加班' },
]

function modelOutput(items) {
  mocks.gatewayComplete.mockResolvedValue({ content: JSON.stringify(items), provider: 'qwen', model: 'qwen-model' })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.memoryFindMany.mockResolvedValue(MEMORIES)
  mocks.edgeFindMany.mockResolvedValue([])
  mocks.edgeFindFirst.mockResolvedValue(null)
  mocks.edgeCreateMany.mockResolvedValue({ count: 1 })
  mocks.edgeUpdate.mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))
  mocks.edgeDeleteMany.mockResolvedValue({ count: 0 })
  mocks.getGateway.mockResolvedValue({ complete: mocks.gatewayComplete })
  modelOutput([])
})

describe('deriveEdges：同意门与前置', () => {
  it('未同意抛 CLOUD_NOT_CONSENTED，不查记忆不调网关', async () => {
    await expect(deriveEdges(USER_ID, REQUEST_ID, { allowExternal: false })).rejects.toMatchObject({
      code: 'CLOUD_NOT_CONSENTED',
    })
    expect(mocks.memoryFindMany).not.toHaveBeenCalled()
    expect(mocks.gatewayComplete).not.toHaveBeenCalled()
  })

  it('记忆不足 2 条时返回零产出，不调网关', async () => {
    mocks.memoryFindMany.mockResolvedValue([{ id: 'm1', content: '只有一条' }])

    expect(await deriveEdges(USER_ID, REQUEST_ID, CONSENT)).toEqual({ created: 0, skipped: 0 })
    expect(mocks.gatewayComplete).not.toHaveBeenCalled()
  })

  it('网关调用参数对齐工作台分析口径（explain 场景 + 编号列表 prompt）', async () => {
    await deriveEdges(USER_ID, REQUEST_ID, CONSENT)

    const call = mocks.gatewayComplete.mock.calls[0][0]
    expect(call).toMatchObject({
      scene: 'explain',
      requestId: REQUEST_ID,
      allowExternal: true,
      timeoutMs: 60000,
      maxTokens: 1200,
      temperature: 0.3,
    })
    expect(typeof call.authorizeExternal).toBe('function')
    const prompt = call.messages[0].content
    expect(prompt).toContain('1. 喜欢火锅')
    expect(prompt).toContain('2. 每周五吃火锅')
    expect(prompt).toContain('similar|related|contradicts')
  })

  it('模型无内容或输出非 JSON 时计零产出', async () => {
    mocks.gatewayComplete.mockResolvedValue({ content: '', provider: 'qwen', model: 'm' })
    expect(await deriveEdges(USER_ID, REQUEST_ID, CONSENT)).toEqual({ created: 0, skipped: 0 })

    mocks.gatewayComplete.mockResolvedValue({ content: '没有 JSON', provider: 'qwen', model: 'm' })
    expect(await deriveEdges(USER_ID, REQUEST_ID, CONSENT)).toEqual({ created: 0, skipped: 0 })
    expect(mocks.edgeCreateMany).not.toHaveBeenCalled()
  })
})

describe('deriveEdges：校验与去重', () => {
  it('合法输出建边：1-based 编号映射回记忆 id，evidence 截断到 2 条', async () => {
    modelOutput([
      { from: 1, to: 2, relation: 'similar', confidence: 'high', evidence: ['片段一', '片段二', '片段三'] },
    ])

    const result = await deriveEdges(USER_ID, REQUEST_ID, CONSENT)

    expect(result).toEqual({ created: 1, skipped: 0 })
    expect(mocks.edgeCreateMany).toHaveBeenCalledWith({
      data: [{
        userId: USER_ID,
        fromMemoryId: 'm1',
        toMemoryId: 'm2',
        relation: 'similar',
        confidence: 'high',
        evidence: JSON.stringify(['片段一', '片段二']),
      }],
    })
  })

  it('越界编号、自环、非法 relation/confidence 计 skipped', async () => {
    modelOutput([
      { from: 1, to: 9, relation: 'similar', confidence: 'low' },
      { from: 1, to: 1, relation: 'similar', confidence: 'low' },
      { from: 1, to: 2, relation: 'loves', confidence: 'low' },
      { from: 1, to: 2, relation: 'related', confidence: 'super' },
      { from: 2, to: 3, relation: 'related', confidence: 'medium' },
    ])

    const result = await deriveEdges(USER_ID, REQUEST_ID, CONSENT)

    expect(result).toEqual({ created: 1, skipped: 4 })
    expect(mocks.edgeCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ fromMemoryId: 'm2', toMemoryId: 'm3', relation: 'related' })],
    })
  })

  it('derived/canonical 既有边按无向对去重（dismissed 不参与去重），批量内重复同样计 skipped', async () => {
    mocks.edgeFindMany.mockResolvedValue([
      { fromMemoryId: 'm2', toMemoryId: 'm1', relation: 'similar' },
    ])
    modelOutput([
      { from: 1, to: 2, relation: 'similar', confidence: 'low' },
      { from: 2, to: 1, relation: 'similar', confidence: 'medium' },
      { from: 1, to: 2, relation: 'related', confidence: 'low' },
    ])

    const result = await deriveEdges(USER_ID, REQUEST_ID, CONSENT)

    expect(result).toEqual({ created: 1, skipped: 2 })
    // 去重查询只覆盖 derived/canonical：dismissed 是草稿处理结果，重建后允许重现
    expect(mocks.edgeFindMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, status: { in: ['derived', 'canonical'] } },
      select: { fromMemoryId: true, toMemoryId: true, relation: true },
    })
    expect(mocks.edgeCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ relation: 'related' })],
    })
  })
})

describe('listEdges', () => {
  const EDGE_ROW = {
    id: 'e1',
    userId: USER_ID,
    fromMemoryId: 'm1',
    toMemoryId: 'm2',
    relation: 'similar',
    confidence: 'high',
    status: 'derived',
    evidence: '["片段"]',
    createdAt: '2026-09-09T00:00:00.000Z',
  }

  it('非法 status 抛 400', async () => {
    await expect(listEdges(USER_ID, { status: 'bogus' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'status 必须是 derived、canonical、dismissed 或 all',
    })
    expect(mocks.edgeFindMany).not.toHaveBeenCalled()
  })

  it('默认 derived 过滤，all 不带状态条件，按创建时间倒序', async () => {
    await listEdges(USER_ID)
    expect(mocks.edgeFindMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, status: 'derived' },
      orderBy: { createdAt: 'desc' },
    })

    await listEdges(USER_ID, { status: 'all' })
    expect(mocks.edgeFindMany).toHaveBeenLastCalledWith({
      where: { userId: USER_ID },
      orderBy: { createdAt: 'desc' },
    })
  })

  it('join 两端记忆内容；任一端缺失的边整条过滤', async () => {
    mocks.edgeFindMany.mockResolvedValue([
      EDGE_ROW,
      { ...EDGE_ROW, id: 'e2', toMemoryId: 'gone' },
    ])
    mocks.memoryFindMany.mockResolvedValue([
      { id: 'm1', content: '喜欢火锅' },
      { id: 'm2', content: '每周五吃火锅' },
    ])

    const edges = await listEdges(USER_ID, { status: 'all' })

    expect(edges).toEqual([{
      id: 'e1',
      relation: 'similar',
      confidence: 'high',
      status: 'derived',
      evidence: ['片段'],
      from: { id: 'm1', content: '喜欢火锅' },
      to: { id: 'm2', content: '每周五吃火锅' },
      createdAt: '2026-09-09T00:00:00.000Z',
    }])
  })

  it('畸形 evidence 按空数组出参', async () => {
    mocks.edgeFindMany.mockResolvedValue([{ ...EDGE_ROW, evidence: 'not-json' }])
    mocks.memoryFindMany.mockResolvedValue([
      { id: 'm1', content: '甲' },
      { id: 'm2', content: '乙' },
    ])

    const edges = await listEdges(USER_ID)
    expect(edges[0].evidence).toEqual([])
  })
})

describe('promoteEdge / dismissEdge', () => {
  it('derived → canonical，返回 join 后的单条', async () => {
    mocks.edgeFindFirst.mockResolvedValue({
      id: 'e1', userId: USER_ID, status: 'derived', fromMemoryId: 'm1', toMemoryId: 'm2',
    })
    mocks.edgeUpdate.mockResolvedValue({
      id: 'e1', userId: USER_ID, status: 'canonical', fromMemoryId: 'm1', toMemoryId: 'm2',
      relation: 'similar', confidence: 'medium', evidence: '[]', createdAt: '2026-09-09T00:00:00.000Z',
    })
    mocks.memoryFindMany.mockResolvedValue([
      { id: 'm1', content: '甲' },
      { id: 'm2', content: '乙' },
    ])

    const edge = await promoteEdge(USER_ID, 'e1')

    expect(mocks.edgeUpdate).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { status: 'canonical' } })
    expect(edge.status).toBe('canonical')
    expect(edge.from).toEqual({ id: 'm1', content: '甲' })
    expect(edge.to).toEqual({ id: 'm2', content: '乙' })
  })

  it('canonical 重复确认抛 400「该关系已确认」，dismissed 抛 400「该条目已处理过」', async () => {
    mocks.edgeFindFirst.mockResolvedValue({ id: 'e1', userId: USER_ID, status: 'canonical' })
    await expect(promoteEdge(USER_ID, 'e1')).rejects.toMatchObject({ statusCode: 400, message: '该关系已确认' })

    mocks.edgeFindFirst.mockResolvedValue({ id: 'e1', userId: USER_ID, status: 'dismissed' })
    await expect(promoteEdge(USER_ID, 'e1')).rejects.toMatchObject({ statusCode: 400, message: '该条目已处理过' })
    expect(mocks.edgeUpdate).not.toHaveBeenCalled()
  })

  it('非本人条目抛 404', async () => {
    await expect(promoteEdge(USER_ID, 'e9')).rejects.toMatchObject({ statusCode: 404, message: '记忆关系不存在' })
    await expect(dismissEdge(USER_ID, 'e9')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('忽略标记 dismissed', async () => {
    mocks.edgeFindFirst.mockResolvedValue({ id: 'e1', userId: USER_ID, status: 'derived' })

    await dismissEdge(USER_ID, 'e1')

    expect(mocks.edgeUpdate).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { status: 'dismissed' } })
  })
})

describe('clearDerivedEdges', () => {
  it('只清 derived/dismissed，canonical 保留为定典历史', async () => {
    mocks.edgeDeleteMany.mockResolvedValue({ count: 4 })

    expect(await clearDerivedEdges(USER_ID)).toBe(4)
    expect(mocks.edgeDeleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, status: { in: ['derived', 'dismissed'] } },
    })
  })
})
