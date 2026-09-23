import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  memoryFindMany: vi.fn(),
  edgeFindMany: vi.fn(),
  edgeCreateMany: vi.fn(),
  getGateway: vi.fn(),
  gatewayComplete: vi.fn(),
}))

vi.mock('../prisma/client.js', () => {
  const client = {
    $queryRaw: vi.fn(async () => [{ id: 'user-1' }]),
    user: { findUnique: vi.fn(async () => ({ memoryEpoch: 0 })), update: vi.fn() },
    memory: { findMany: mocks.memoryFindMany },
    memoryEdge: {
      findMany: mocks.edgeFindMany,
      createMany: mocks.edgeCreateMany,
    },
  }
  client.$transaction = vi.fn((operation) => operation(client))
  return { default: client }
})
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

import { deriveEdges } from './edgeService.js'

const USER_ID = 'user-1'
const REQUEST_ID = 'req-1'
const CONSENT = { allowExternal: true, authorizeExternal: async () => true }
const MEMORIES = [
  { id: 'm1', content: '喜欢火锅', revision: 1 },
  { id: 'm2', content: '每周五吃火锅', revision: 1 },
  { id: 'm3', content: '周五晚上固定加班', revision: 1 },
]

function modelOutput(items) {
  mocks.gatewayComplete.mockResolvedValue({ content: JSON.stringify(items), provider: 'qwen', model: 'qwen-model' })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.memoryFindMany.mockResolvedValue(MEMORIES)
  mocks.edgeFindMany.mockResolvedValue([])
  mocks.edgeCreateMany.mockResolvedValue({ count: 1 })
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
      { from: 1, to: 2, relation: 'similar', confidence: 'high', evidence: ['喜欢火锅', '每周五', '片段三'] },
    ])

    const result = await deriveEdges(USER_ID, REQUEST_ID, CONSENT)

    expect(result).toEqual({ created: 1, skipped: 0 })
    expect(mocks.edgeCreateMany).toHaveBeenCalledWith({
      data: [{
        userId: USER_ID,
        fromMemoryId: 'm1',
        toMemoryId: 'm2',
        fromRevision: 1, toRevision: 1,
        relation: 'similar',
        confidence: 'high',
        evidence: JSON.stringify([{ type: 'memory', id: 'm1', revision: 1, quote: '喜欢火锅' }, { type: 'memory', id: 'm2', revision: 1, quote: '每周五' }]),
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

  it('既有边按无向对去重，重审和已有用户决定的关系不会被后台覆盖', async () => {
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
    expect(mocks.edgeFindMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, OR: [{ status: { in: ['derived', 'canonical', 'needs_review'] } }, { NOT: { decisions: { equals: [] } } }] },
      select: { fromMemoryId: true, toMemoryId: true, relation: true },
    })
    expect(mocks.edgeCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ relation: 'related' })],
    })
  })
})
