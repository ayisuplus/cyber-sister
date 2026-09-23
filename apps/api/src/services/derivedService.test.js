import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  messageFindMany: vi.fn(),
  memoryFindMany: vi.fn(),
  derivedFindMany: vi.fn(),
  derivedCreateMany: vi.fn(),
  getGateway: vi.fn(),
  gatewayComplete: vi.fn(),
  deriveEdges: vi.fn(),
  saveFollowUps: vi.fn(),
  diaryFindMany: vi.fn(),
  diaryFindFirst: vi.fn(),
  readingNoteFindMany: vi.fn(),
  reminderFindMany: vi.fn(),
  collectionFindMany: vi.fn(),
}))

vi.mock('../prisma/client.js', () => {
  const client = {
    $queryRaw: vi.fn(async () => [{ id: 'user-1' }]),
    user: { findUnique: mocks.userFindUnique },
    message: { findMany: mocks.messageFindMany,
      findFirst: vi.fn(async () => ({ id: 'msg-source', role: 'user', content: 'synthetic source' })) },
    memory: { findMany: mocks.memoryFindMany },
    derivedInsight: { findMany: mocks.derivedFindMany, createMany: mocks.derivedCreateMany },
    diaryEntry: { findMany: mocks.diaryFindMany, findFirst: mocks.diaryFindFirst },
    readingNote: { findMany: mocks.readingNoteFindMany },
    scheduledReminder: { findMany: mocks.reminderFindMany },
    collectionItem: { findMany: mocks.collectionFindMany },
  }
  client.$transaction = vi.fn((operation) => operation(client))
  return { default: client }
})
vi.mock('./followUpService.js', () => ({
  FOLLOW_UP_LEAD_DAYS: 30,
  saveFollowUps: mocks.saveFollowUps,
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
vi.mock('./edgeService.js', () => ({ deriveEdges: mocks.deriveEdges }))
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { runAnalysis } from './derivedService.js'

const USER_ID = 'user-1'
const REQUEST_ID = 'req-1'
const CONSENT = { allowExternal: true, authorizeExternal: async () => true }
// 回想入口由写信触发：runAnalysis(userId, requestId, { consent, now })
const think = (now) => runAnalysis(USER_ID, REQUEST_ID, { consent: CONSENT, now })
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
  mocks.userFindUnique.mockResolvedValue({ memoryEpoch: 0, persona: 'gentle' })
  mocks.messageFindMany.mockResolvedValue([])
  mocks.memoryFindMany.mockResolvedValue([])
  mocks.derivedFindMany.mockResolvedValue([])
  mocks.derivedCreateMany.mockResolvedValue({ count: 1 })
  mocks.diaryFindMany.mockResolvedValue([])
  mocks.diaryFindFirst.mockResolvedValue(null)
  mocks.readingNoteFindMany.mockResolvedValue([])
  mocks.reminderFindMany.mockResolvedValue([])
  mocks.collectionFindMany.mockResolvedValue([])
  mocks.getGateway.mockResolvedValue({ complete: mocks.gatewayComplete })
  modelOutput([VALID_INSIGHT])
  mocks.deriveEdges.mockResolvedValue({ created: 2, skipped: 0 })
})

describe('工作台：解析与候选校验', () => {
  it('模型输出非 JSON 时按无候选处理（created 0 / skipped 0）', async () => {
    mocks.gatewayComplete.mockResolvedValue({ content: '这不是 JSON，抱歉', provider: 'qwen', model: 'm' })

    const result = await think()

    expect(result).toEqual({ created: 0, skipped: 0 })
    expect(mocks.derivedCreateMany).not.toHaveBeenCalled()
  })

  it('空数组输出时不落库', async () => {
    modelOutput([])

    const result = await think()

    expect(result).toEqual({ created: 0, skipped: 0, edgesCreated: 2, followUpsCreated: 0 })
    expect(mocks.derivedCreateMany).not.toHaveBeenCalled()
  })

  it('非法 kind/confidence/超长 content 计入 skipped，合法项落库且非法 evidence 置空', async () => {
    modelOutput([
      { kind: 'wild', content: '类型越界', confidence: 'low' },
      { kind: 'pattern', content: '置信度越界', confidence: 'super' },
      { kind: 'pattern', content: '长'.repeat(201), confidence: 'low' },
      { kind: 'summary', content: '她最近在准备面试', confidence: 'high', evidence: '不是数组' },
    ])

    const result = await think()

    expect(result).toEqual({ created: 1, skipped: 3, edgesCreated: 2, followUpsCreated: 0 })
    expect(mocks.derivedCreateMany).toHaveBeenCalledWith({
      data: [{
        userId: USER_ID,
        kind: 'summary',
        content: '她最近在准备面试',
        evidence: '[]',
        sources: [], sourceMemoryIds: [],
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

    const result = await think()

    expect(result).toEqual({ created: 1, skipped: 2, edgesCreated: 2, followUpsCreated: 0 })
  })

  it('与 active 既有条目规范化去重，批量内重复同样计入 skipped', async () => {
    mocks.derivedFindMany.mockResolvedValue([{ content: '她习惯深夜学习' }])
    modelOutput([
      { kind: 'pattern', content: '  她习惯深夜学习 ', confidence: 'medium' },
      { kind: 'summary', content: '她习惯深夜学习', confidence: 'high' },
      { kind: 'summary', content: '她这周睡得不错', confidence: 'medium' },
    ])

    const result = await think()

    expect(result).toEqual({ created: 1, skipped: 2, edgesCreated: 2, followUpsCreated: 0 })
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

    await think()

    const prompt = mocks.gatewayComplete.mock.calls[0][0].messages[0].content
    expect(prompt).toContain('今天加班到十点')
    expect(prompt).not.toContain('我想自杀')
  })

  it('手记痕迹进回想素材，evidence 逐字引用时回指手记来源', async () => {
    const diary = { id: 'd1', userId: USER_ID, day: new Date('2026-09-20T00:00:00.000Z'), content: '今天在工作室待到很晚，把展览方案定了下来' }
    mocks.diaryFindMany.mockResolvedValue([diary])
    mocks.diaryFindFirst.mockResolvedValue(diary)
    modelOutput([
      { kind: 'pattern', content: '她最近在准备展览方案', confidence: 'medium', evidence: ['把展览方案定了下来'] },
    ])

    const result = await think()

    expect(result.created).toBe(1)
    expect(mocks.gatewayComplete.mock.calls[0][0].messages[0].content).toContain('【手记 2026-09-20】')
    expect(mocks.derivedCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        evidence: '["把展览方案定了下来"]',
        sources: [{ type: 'diary', id: 'd1', quote: '把展览方案定了下来', status: 'verified' }],
        sourceMemoryIds: [],
      })],
    })
  })

  it('含医疗内容的痕迹不进回想素材', async () => {
    mocks.diaryFindMany.mockResolvedValue([
      { id: 'd1', userId: USER_ID, day: new Date('2026-09-20T00:00:00.000Z'), content: '今天月经来了，肚子疼了一下午' },
    ])
    modelOutput([])

    await think()

    const prompt = mocks.gatewayComplete.mock.calls[0][0].messages[0].content
    expect(prompt).not.toContain('月经')
    expect(prompt).not.toContain('【手记')
  })
})

describe('工作台：记忆关系派生挂接', () => {
  it('分析成功后以同款同意装配调用 deriveEdges，返回带 edgesCreated', async () => {
    const result = await think()

    expect(mocks.deriveEdges).toHaveBeenCalledWith(USER_ID, REQUEST_ID, {
      allowExternal: true,
      authorizeExternal: expect.any(Function),
    })
    expect(result).toEqual({ created: 1, skipped: 0, edgesCreated: 2, followUpsCreated: 0 })
  })

  it('边派生失败不拖垮条目分析', async () => {
    mocks.deriveEdges.mockRejectedValue(new Error('edge boom'))

    const result = await think()

    expect(result).toEqual({ created: 1, skipped: 0, edgesCreated: 0, followUpsCreated: 0 })
  })

  it('解析失败的提前返回不产出 edgesCreated，也不派生边', async () => {
    mocks.gatewayComplete.mockResolvedValue({ content: '没有 JSON', provider: 'qwen', model: 'm' })

    const result = await think()

    expect(result).toEqual({ created: 0, skipped: 0 })
    expect(mocks.deriveEdges).not.toHaveBeenCalled()
  })
})

describe('回想写得像她，并记下惦记的事', () => {
  // 北京时间 2026-09-21 星期一 上午 10 点
  const MONDAY = new Date('2026-09-21T02:00:00.000Z')
  const thinkOn = (now = MONDAY) => think(now)

  beforeEach(() => {
    mocks.saveFollowUps.mockResolvedValue({ created: 1, skipped: 0 })
  })

  it('提示词用第二人称，并告诉模型今天是北京时间的哪一天', async () => {
    modelOutput([])
    await thinkOn()
    const prompt = mocks.gatewayComplete.mock.calls[0][0].messages[0].content
    expect(prompt).toContain('用第二人称（"你"）')
    expect(prompt).not.toContain('用第三人称')
    expect(prompt).toContain('今天是 2026-09-21（星期一）')
    expect(prompt).toContain('用她选的说话方式写（温柔')
  })

  it('惦记的事那句问话按她当前的说话方式写', async () => {
    mocks.userFindUnique.mockResolvedValue({ memoryEpoch: 0, persona: 'cool' })
    modelOutput([])
    await thinkOn()
    const prompt = mocks.gatewayComplete.mock.calls[0][0].messages[0].content
    expect(prompt).toContain('用她选的说话方式写（安静')
  })

  it('惦记的事单独交给 followUpService，不进草稿', async () => {
    modelOutput([
      VALID_INSIGHT,
      { kind: 'followup', about: '周三答辩', ask: '答辩怎么样了？', askOn: '2026-09-24' },
    ])

    const result = await thinkOn()

    expect(mocks.saveFollowUps).toHaveBeenCalledWith(USER_ID, [
      { about: '周三答辩', ask: '答辩怎么样了？', askOn: new Date('2026-09-24T00:00:00.000Z') },
    ])
    expect(mocks.derivedCreateMany.mock.calls[0][0].data.map((item) => item.kind)).toEqual(['pattern'])
    expect(result).toMatchObject({ created: 1, followUpsCreated: 1 })
  })

  it('日子不在明天到 30 天内、格式不对、太长或含敏感内容的都丢掉', async () => {
    modelOutput([
      { kind: 'followup', about: '今天的事', ask: '怎么样了？', askOn: '2026-09-21' },
      { kind: 'followup', about: '明年的事', ask: '怎么样了？', askOn: '2026-12-31' },
      { kind: 'followup', about: '日期写错', ask: '怎么样了？', askOn: '下周三' },
      { kind: 'followup', about: '长'.repeat(41), ask: '怎么样了？', askOn: '2026-09-24' },
      { kind: 'followup', about: '去医院复查抑郁症', ask: '复查怎么样？', askOn: '2026-09-24' },
      { kind: 'followup', about: '周五面试', ask: '面试顺利吗？', askOn: '2026-09-26' },
    ])

    await thinkOn()

    expect(mocks.saveFollowUps).toHaveBeenCalledWith(USER_ID, [
      { about: '周五面试', ask: '面试顺利吗？', askOn: new Date('2026-09-26T00:00:00.000Z') },
    ])
  })

  it('没有惦记的事就不去碰存储', async () => {
    modelOutput([VALID_INSIGHT])
    await thinkOn()
    expect(mocks.saveFollowUps).not.toHaveBeenCalled()
  })
})
