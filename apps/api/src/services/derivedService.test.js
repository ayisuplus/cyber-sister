import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  messageFindMany: vi.fn(),
  messageCount: vi.fn(),
  memoryFindMany: vi.fn(),
  memoryFindUnique: vi.fn(),
  memoryCreate: vi.fn(),
  derivedFindMany: vi.fn(),
  derivedFindFirst: vi.fn(),
  derivedCreateMany: vi.fn(),
  derivedUpdate: vi.fn(),
  derivedDeleteMany: vi.fn(),
  getGateway: vi.fn(),
  gatewayComplete: vi.fn(),
  deriveEdges: vi.fn(),
  clearDerivedEdges: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    user: { findUnique: mocks.userFindUnique },
    message: { findMany: mocks.messageFindMany, count: mocks.messageCount },
    memory: {
      findMany: mocks.memoryFindMany,
      findUnique: mocks.memoryFindUnique,
      create: mocks.memoryCreate,
    },
    derivedInsight: {
      findMany: mocks.derivedFindMany,
      findFirst: mocks.derivedFindFirst,
      createMany: mocks.derivedCreateMany,
      update: mocks.derivedUpdate,
      deleteMany: mocks.derivedDeleteMany,
    },
  },
}))
// 保留 llmService 的真实错误类，只替换网关装配与同意门前置断言
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
vi.mock('./edgeService.js', () => ({
  deriveEdges: mocks.deriveEdges,
  clearDerivedEdges: mocks.clearDerivedEdges,
}))
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  analyzeNow,
  clearInsights,
  dismissInsight,
  listInsights,
  maybeAutoAnalyze,
  promoteInsight,
  rebuildInsights,
  resolveInsight,
} from './derivedService.js'

const USER_ID = 'user-1'
const REQUEST_ID = 'req-1'
const CONSENTED = { externalLlmConsent: true, externalLlmConsentVersion: 'cloud-primary-v3' }
const NOT_CONSENTED = { externalLlmConsent: null, externalLlmConsentVersion: null }
const VALID_INSIGHT = {
  kind: 'pattern',
  content: '她习惯深夜学习',
  confidence: 'medium',
  evidence: ['最近都聊到凌晨'],
}

function modelOutput(items) {
  mocks.gatewayComplete.mockResolvedValue({
    content: JSON.stringify(items),
    provider: 'qwen',
    model: 'qwen-model',
    scope: 'external',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.userFindUnique.mockResolvedValue(CONSENTED)
  mocks.messageFindMany.mockResolvedValue([])
  mocks.messageCount.mockResolvedValue(0)
  mocks.memoryFindMany.mockResolvedValue([])
  mocks.memoryCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'mem-new', ...data }))
  mocks.derivedFindMany.mockResolvedValue([])
  mocks.derivedFindFirst.mockResolvedValue(null)
  mocks.derivedCreateMany.mockResolvedValue({ count: 1 })
  mocks.derivedUpdate.mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))
  mocks.derivedDeleteMany.mockResolvedValue({ count: 0 })
  mocks.getGateway.mockResolvedValue({ complete: mocks.gatewayComplete })
  modelOutput([VALID_INSIGHT])
  mocks.deriveEdges.mockResolvedValue({ created: 2, skipped: 0 })
  mocks.clearDerivedEdges.mockResolvedValue(1)
})

describe('工作台：同意门', () => {
  it('maybeAutoAnalyze 未同意时返回 not_consented，不查消息也不调网关', async () => {
    mocks.userFindUnique.mockResolvedValue(NOT_CONSENTED)

    const result = await maybeAutoAnalyze(USER_ID, REQUEST_ID)

    expect(result).toEqual({ skipped: 'not_consented', created: 0 })
    expect(mocks.derivedFindFirst).not.toHaveBeenCalled()
    expect(mocks.gatewayComplete).not.toHaveBeenCalled()
  })

  it('analyzeNow 未同意时抛 CLOUD_NOT_CONSENTED（503），不调网关', async () => {
    mocks.userFindUnique.mockResolvedValue(NOT_CONSENTED)

    await expect(analyzeNow(USER_ID, REQUEST_ID)).rejects.toMatchObject({
      code: 'CLOUD_NOT_CONSENTED',
      statusCode: 503,
    })
    expect(mocks.gatewayComplete).not.toHaveBeenCalled()
  })

  it('已同意时走 explain 场景并提供 authorizeExternal 重读同意', async () => {
    await analyzeNow(USER_ID, REQUEST_ID)

    const call = mocks.gatewayComplete.mock.calls[0][0]
    expect(call).toMatchObject({ scene: 'explain', requestId: REQUEST_ID, allowExternal: true })
    expect(typeof call.authorizeExternal).toBe('function')
    await expect(call.authorizeExternal()).resolves.toBe(true)
  })
})

describe('工作台：自动分析阈值', () => {
  it('最新条目后新消息 5 条时返回 threshold，不调网关', async () => {
    mocks.derivedFindFirst.mockResolvedValue({ createdAt: new Date('2026-09-07T00:00:00.000Z') })
    mocks.messageCount.mockResolvedValue(5)

    const result = await maybeAutoAnalyze(USER_ID, REQUEST_ID)

    expect(result).toEqual({ skipped: 'threshold', created: 0 })
    expect(mocks.messageCount).toHaveBeenCalledWith({
      where: {
        conversation: { userId: USER_ID },
        createdAt: { gt: new Date('2026-09-07T00:00:00.000Z') },
      },
    })
    expect(mocks.gatewayComplete).not.toHaveBeenCalled()
  })

  it('新消息 6 条时执行分析并落库', async () => {
    mocks.derivedFindFirst.mockResolvedValue({ createdAt: new Date('2026-09-07T00:00:00.000Z') })
    mocks.messageCount.mockResolvedValue(6)

    const result = await maybeAutoAnalyze(USER_ID, REQUEST_ID)

    expect(result).toEqual({ created: 1, skipped: 0, edgesCreated: 2 })
    expect(mocks.derivedCreateMany).toHaveBeenCalledWith({
      data: [{
        userId: USER_ID,
        kind: 'pattern',
        content: '她习惯深夜学习',
        evidence: JSON.stringify(['最近都聊到凌晨']),
        confidence: 'medium',
      }],
    })
  })

  it('网关无内容时自动路径静默返回零计数，手动路径抛 LLM_UNAVAILABLE', async () => {
    mocks.gatewayComplete.mockResolvedValue(null)
    mocks.messageCount.mockResolvedValue(6)

    await expect(maybeAutoAnalyze(USER_ID, REQUEST_ID)).resolves.toEqual({ created: 0, skipped: 0 })
    await expect(analyzeNow(USER_ID, REQUEST_ID)).rejects.toMatchObject({
      code: 'LLM_UNAVAILABLE',
      statusCode: 503,
    })
  })
})

describe('工作台：解析与候选校验', () => {
  it('模型输出非 JSON 时按无候选处理（created 0 / skipped 0）', async () => {
    mocks.gatewayComplete.mockResolvedValue({ content: '这不是 JSON，抱歉', provider: 'qwen', model: 'm' })

    const result = await analyzeNow(USER_ID, REQUEST_ID)

    expect(result).toEqual({ created: 0, skipped: 0 })
    expect(mocks.derivedCreateMany).not.toHaveBeenCalled()
  })

  it('空数组输出时不落库', async () => {
    modelOutput([])

    const result = await analyzeNow(USER_ID, REQUEST_ID)

    expect(result).toEqual({ created: 0, skipped: 0, edgesCreated: 2 })
    expect(mocks.derivedCreateMany).not.toHaveBeenCalled()
  })

  it('非法 kind/confidence/超长 content 计入 skipped，合法项落库且非法 evidence 置空', async () => {
    modelOutput([
      { kind: 'wild', content: '类型越界', confidence: 'low' },
      { kind: 'pattern', content: '置信度越界', confidence: 'super' },
      { kind: 'pattern', content: '长'.repeat(201), confidence: 'low' },
      { kind: 'summary', content: '她最近在准备面试', confidence: 'high', evidence: '不是数组' },
    ])

    const result = await analyzeNow(USER_ID, REQUEST_ID)

    expect(result).toEqual({ created: 1, skipped: 3, edgesCreated: 2 })
    expect(mocks.derivedCreateMany).toHaveBeenCalledWith({
      data: [{
        userId: USER_ID,
        kind: 'summary',
        content: '她最近在准备面试',
        evidence: '[]',
        confidence: 'high',
      }],
    })
  })

  it('命中敏感占位符或医疗模式的候选被丢弃', async () => {
    modelOutput([
      { kind: 'pattern', content: '她告诉我[手机号]让我打给她', confidence: 'low' },
      { kind: 'hypothesis', content: '她复诊时拿了新处方', confidence: 'low' },
      { kind: 'pattern', content: '她习惯深夜学习', confidence: 'medium' },
    ])

    const result = await analyzeNow(USER_ID, REQUEST_ID)

    expect(result).toEqual({ created: 1, skipped: 2, edgesCreated: 2 })
  })

  it('与 active 既有条目规范化去重，批量内重复同样计入 skipped', async () => {
    mocks.derivedFindMany.mockResolvedValue([{ content: '她习惯深夜学习' }])
    modelOutput([
      { kind: 'pattern', content: '  她习惯深夜学习 ', confidence: 'medium' },
      { kind: 'summary', content: '她习惯深夜学习', confidence: 'high' },
      { kind: 'summary', content: '她这周睡得不错', confidence: 'medium' },
    ])

    const result = await analyzeNow(USER_ID, REQUEST_ID)

    expect(result).toEqual({ created: 1, skipped: 2, edgesCreated: 2 })
    expect(mocks.derivedCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ content: '她这周睡得不错' })],
    })
  })

  it('危机消息不进入分析输入', async () => {
    mocks.messageFindMany.mockResolvedValue([
      { role: 'user', content: '今天加班到十点' },
      { role: 'user', content: '我想自杀' },
    ])
    modelOutput([])

    await analyzeNow(USER_ID, REQUEST_ID)

    const prompt = mocks.gatewayComplete.mock.calls[0][0].messages[0].content
    expect(prompt).toContain('今天加班到十点')
    expect(prompt).not.toContain('我想自杀')
  })
})

describe('工作台：晋升与治理', () => {
  const OWNED = { id: 'insight-1', userId: USER_ID, content: '她习惯深夜学习', status: 'active' }

  it('晋升创建显式记忆并标记 promoted + promotedMemoryId', async () => {
    mocks.derivedFindFirst.mockResolvedValue(OWNED)

    const result = await promoteInsight(USER_ID, 'insight-1')

    expect(mocks.memoryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: USER_ID,
        type: 'semantic',
        content: '她习惯深夜学习',
        importance: 5,
        origin: 'promoted',
        sourceRef: 'insight-1',
      }),
    })
    expect(mocks.derivedUpdate).toHaveBeenCalledWith({
      where: { id: 'insight-1' },
      data: { status: 'promoted', promotedMemoryId: 'mem-new' },
    })
    expect(result.memory.id).toBe('mem-new')
    expect(result.insight.status).toBe('promoted')
  })

  it('已有规范化键相同的显式记忆时不重复创建，仅标记晋升', async () => {
    mocks.derivedFindFirst.mockResolvedValue({ ...OWNED, content: '她习惯深夜学习 ' })
    mocks.memoryFindMany.mockResolvedValue([{ id: 'mem-9', content: '她习惯深夜学习' }])
    mocks.memoryFindUnique.mockResolvedValue({ id: 'mem-9', content: '她习惯深夜学习' })

    const result = await promoteInsight(USER_ID, 'insight-1', { type: 'episodic', importance: 8 })

    expect(mocks.memoryCreate).not.toHaveBeenCalled()
    expect(mocks.derivedUpdate).toHaveBeenCalledWith({
      where: { id: 'insight-1' },
      data: { status: 'promoted', promotedMemoryId: 'mem-9' },
    })
    expect(result.memory.id).toBe('mem-9')
  })

  it('非本人条目晋升抛 404，忽略抛 404', async () => {
    mocks.derivedFindFirst.mockResolvedValue(null)

    await expect(promoteInsight(USER_ID, 'insight-x')).rejects.toMatchObject({
      statusCode: 404,
      message: '工作台条目不存在',
    })
    await expect(dismissInsight(USER_ID, 'insight-x')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('忽略标记 dismissed，清空返回删除数', async () => {
    mocks.derivedFindFirst.mockResolvedValue(OWNED)
    await dismissInsight(USER_ID, 'insight-1')
    expect(mocks.derivedUpdate).toHaveBeenCalledWith({
      where: { id: 'insight-1' },
      data: { status: 'dismissed' },
    })

    mocks.derivedDeleteMany.mockResolvedValue({ count: 3 })
    await expect(clearInsights(USER_ID)).resolves.toBe(3)
    expect(mocks.derivedDeleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } })
  })
})

describe('工作台：列表', () => {
  it('默认按 active 过滤，all 不带状态条件', async () => {
    await listInsights(USER_ID)
    expect(mocks.derivedFindMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, status: 'active' },
      orderBy: { createdAt: 'desc' },
    })

    await listInsights(USER_ID, { status: 'all' })
    expect(mocks.derivedFindMany).toHaveBeenLastCalledWith({
      where: { userId: USER_ID },
      orderBy: { createdAt: 'desc' },
    })
  })

  it('status: resolved 合法', async () => {
    await listInsights(USER_ID, { status: 'resolved' })
    expect(mocks.derivedFindMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, status: 'resolved' },
      orderBy: { createdAt: 'desc' },
    })
  })

  it('非法 status 抛 400，文案含 resolved', async () => {
    await expect(listInsights(USER_ID, { status: 'bogus' })).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('resolved'),
    })
    expect(mocks.derivedFindMany).not.toHaveBeenCalled()
  })
})

describe('工作台：冲突厘清', () => {
  const CONFLICT = { id: 'insight-c', userId: USER_ID, kind: 'conflict', content: '她既想独居又想合住', status: 'active' }

  it('非冲突条目厘清抛 400', async () => {
    mocks.derivedFindFirst.mockResolvedValue({ ...CONFLICT, kind: 'pattern' })

    await expect(resolveInsight(USER_ID, 'insight-c', { content: '定稿' })).rejects.toMatchObject({
      statusCode: 400,
      message: '只有冲突条目需要厘清',
    })
    expect(mocks.memoryCreate).not.toHaveBeenCalled()
  })

  it('已处理过的条目厘清抛 400', async () => {
    mocks.derivedFindFirst.mockResolvedValue({ ...CONFLICT, status: 'resolved' })

    await expect(resolveInsight(USER_ID, 'insight-c', { content: '定稿' })).rejects.toMatchObject({
      statusCode: 400,
      message: '该条目已处理过',
    })
    expect(mocks.memoryCreate).not.toHaveBeenCalled()
  })

  it('厘清定稿建记忆（origin=promoted、sourceRef=条目 id），条目 resolved 并留存定稿', async () => {
    mocks.derivedFindFirst.mockResolvedValue(CONFLICT)

    const result = await resolveInsight(USER_ID, 'insight-c', { content: '她想要的是独立书房', importance: 8 })

    expect(mocks.memoryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: USER_ID,
        content: '她想要的是独立书房',
        importance: 8,
        origin: 'promoted',
        sourceRef: 'insight-c',
      }),
    })
    expect(mocks.derivedUpdate).toHaveBeenCalledWith({
      where: { id: 'insight-c' },
      data: { status: 'resolved', resolution: '她想要的是独立书房', promotedMemoryId: 'mem-new' },
    })
    expect(result.memory.id).toBe('mem-new')
    expect(result.insight.status).toBe('resolved')
  })

  it('定稿与既有记忆规范化键相同时不重复创建', async () => {
    mocks.derivedFindFirst.mockResolvedValue(CONFLICT)
    mocks.memoryFindMany.mockResolvedValue([{ id: 'mem-9', content: '她想要的是独立书房' }])
    mocks.memoryFindUnique.mockResolvedValue({ id: 'mem-9', content: '她想要的是独立书房' })

    const result = await resolveInsight(USER_ID, 'insight-c', { content: ' 她想要的是独立书房 ' })

    expect(mocks.memoryCreate).not.toHaveBeenCalled()
    expect(mocks.derivedUpdate).toHaveBeenCalledWith({
      where: { id: 'insight-c' },
      data: { status: 'resolved', resolution: '她想要的是独立书房', promotedMemoryId: 'mem-9' },
    })
    expect(result.memory.id).toBe('mem-9')
  })
})

describe('工作台：重建', () => {
  it('未同意抛 CLOUD_NOT_CONSENTED，且一行不删', async () => {
    mocks.userFindUnique.mockResolvedValue(NOT_CONSENTED)

    await expect(rebuildInsights(USER_ID, REQUEST_ID)).rejects.toMatchObject({
      code: 'CLOUD_NOT_CONSENTED',
      statusCode: 503,
    })
    expect(mocks.derivedDeleteMany).not.toHaveBeenCalled()
    expect(mocks.gatewayComplete).not.toHaveBeenCalled()
  })

  it('已同意：只清 active/dismissed，promoted/resolved 保留，随后重新分析', async () => {
    mocks.derivedDeleteMany.mockResolvedValue({ count: 2 })

    const result = await rebuildInsights(USER_ID, REQUEST_ID)

    expect(mocks.derivedDeleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, status: { in: ['active', 'dismissed'] } },
    })
    expect(mocks.gatewayComplete).toHaveBeenCalled()
    expect(result).toEqual({ cleared: 2, edgesCleared: 1, created: 1, skipped: 0, edgesCreated: 2 })
  })

  it('重建先清派生/已忽略关系边（canonical 保留），clearDerivedEdges 被调', async () => {
    mocks.derivedDeleteMany.mockResolvedValue({ count: 0 })

    await rebuildInsights(USER_ID, REQUEST_ID)

    expect(mocks.clearDerivedEdges).toHaveBeenCalledWith(USER_ID)
  })
})

describe('工作台：记忆关系派生挂接', () => {
  it('分析成功后以同款同意装配调用 deriveEdges，返回带 edgesCreated', async () => {
    const result = await analyzeNow(USER_ID, REQUEST_ID)

    expect(mocks.deriveEdges).toHaveBeenCalledWith(USER_ID, REQUEST_ID, {
      allowExternal: true,
      authorizeExternal: expect.any(Function),
    })
    expect(result).toEqual({ created: 1, skipped: 0, edgesCreated: 2 })
  })

  it('边派生失败不拖垮条目分析', async () => {
    mocks.deriveEdges.mockRejectedValue(new Error('edge boom'))

    const result = await analyzeNow(USER_ID, REQUEST_ID)

    expect(result).toEqual({ created: 1, skipped: 0, edgesCreated: 0 })
  })

  it('解析失败的提前返回不产出 edgesCreated，也不派生边', async () => {
    mocks.gatewayComplete.mockResolvedValue({ content: '没有 JSON', provider: 'qwen', model: 'm' })

    const result = await analyzeNow(USER_ID, REQUEST_ID)

    expect(result).toEqual({ created: 0, skipped: 0 })
    expect(mocks.deriveEdges).not.toHaveBeenCalled()
  })
})
