import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  memoryFindMany: vi.fn(),
  conversationFindMany: vi.fn(),
  todoFindMany: vi.fn(),
  countdownFindMany: vi.fn(),
  periodFindMany: vi.fn(),
  reminderFindMany: vi.fn(),
  diaryFindMany: vi.fn(),
  habitFindMany: vi.fn(),
  bookFindMany: vi.fn(),
  studyFindMany: vi.fn(),
  derivedFindMany: vi.fn(),
  makeupPresetFindMany: vi.fn(),
  wardrobeItemFindMany: vi.fn(),
  edgeFindMany: vi.fn(),
  letterFindMany: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    user: { findUnique: db.userFindUnique },
    memory: { findMany: db.memoryFindMany },
    conversation: { findMany: db.conversationFindMany },
    todo: { findMany: db.todoFindMany },
    countdown: { findMany: db.countdownFindMany },
    periodRecord: { findMany: db.periodFindMany },
    reminder: { findMany: db.reminderFindMany },
    diaryEntry: { findMany: db.diaryFindMany },
    habit: { findMany: db.habitFindMany },
    book: { findMany: db.bookFindMany },
    studySession: { findMany: db.studyFindMany },
    derivedInsight: { findMany: db.derivedFindMany },
    makeupPreset: { findMany: db.makeupPresetFindMany },
    wardrobeItem: { findMany: db.wardrobeItemFindMany },
    memoryEdge: { findMany: db.edgeFindMany },
    letter: { findMany: db.letterFindMany },
  },
}))

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { buildUserExport, EXPORT_VERSION } from './exportService.js'

describe('exportService.buildUserExport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.userFindUnique.mockResolvedValue({
      nickname: '小赛',
      persona: 'toxic',
      roleName: '同桌的你',
      roleSetting: '爱吐槽但会帮我讲题',
      birthDate: null,
      externalLlmConsent: true,
      externalLlmConsentVersion: 'cloud-primary-v3',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    })
    for (const key of [
      'memoryFindMany', 'conversationFindMany', 'todoFindMany', 'countdownFindMany',
      'periodFindMany', 'reminderFindMany', 'diaryFindMany', 'habitFindMany',
      'bookFindMany', 'studyFindMany', 'derivedFindMany',
      'makeupPresetFindMany', 'wardrobeItemFindMany', 'edgeFindMany', 'letterFindMany',
    ]) {
      db[key].mockResolvedValue([])
    }
  })

  it('导出包带版本号与产品标识，user 段不含内部 id 与凭据字段', async () => {
    const bundle = await buildUserExport('user-1')

    expect(bundle.version).toBe(EXPORT_VERSION)
    expect(bundle.product).toBe('Amie cyber-sister')
    expect(typeof bundle.exportedAt).toBe('string')
    expect(bundle.user).toMatchObject({ nickname: '小赛', persona: 'toxic', roleName: '同桌的你' })
    expect(JSON.stringify(bundle.user)).not.toContain('phone')
    expect(JSON.stringify(bundle.user)).not.toContain('password')
    expect(JSON.stringify(bundle)).not.toContain('refreshToken')
  })

  it('全部 16 张表按当前用户过滤查询', async () => {
    await buildUserExport('user-1')

    for (const key of [
      'memoryFindMany', 'conversationFindMany', 'todoFindMany', 'countdownFindMany',
      'periodFindMany', 'reminderFindMany', 'diaryFindMany', 'habitFindMany',
      'bookFindMany', 'studyFindMany', 'derivedFindMany',
      'makeupPresetFindMany', 'wardrobeItemFindMany', 'edgeFindMany', 'letterFindMany',
    ]) {
      expect(db[key]).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId: 'user-1' },
      }))
    }
  })

  it('妆容预设全字段导出；衣柜只导出单品元数据（二进制资产走 v1 边界）', async () => {
    db.makeupPresetFindMany.mockResolvedValue([
      { name: '日常', smooth: 30, whiten: 20, slim: 10, eye: 10, createdAt: new Date('2026-09-08T00:00:00.000Z'), updatedAt: new Date('2026-09-08T01:00:00.000Z') },
    ])
    db.wardrobeItemFindMany.mockResolvedValue([
      { name: '黑色风衣', createdAt: new Date('2026-09-08T02:00:00.000Z') },
    ])

    const bundle = await buildUserExport('user-1')

    expect(bundle.makeupPresets).toEqual([
      { name: '日常', smooth: 30, whiten: 20, slim: 10, eye: 10, createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T01:00:00.000Z' },
    ])
    expect(bundle.wardrobeItems).toEqual([{ name: '黑色风衣', createdAt: '2026-09-08T02:00:00.000Z' }])
    expect(JSON.stringify(bundle.wardrobeItems)).not.toContain('sourceExt')
  })

  it('关系边按内容引用导出（含草稿状态），来信随包导出', async () => {
    db.edgeFindMany.mockResolvedValue([
      { relation: 'similar', confidence: 'high', status: 'canonical', createdAt: new Date('2026-09-09T00:00:00.000Z'), fromMemory: { content: '喜欢火锅' }, toMemory: { content: '每周五吃火锅' } },
      { relation: 'related', confidence: 'low', status: 'derived', createdAt: new Date('2026-09-09T01:00:00.000Z'), fromMemory: { content: '甲' }, toMemory: { content: '乙' } },
    ])
    db.letterFindMany.mockResolvedValue([
      { weekStart: new Date('2026-09-07T00:00:00.000Z'), content: '信的内容', createdAt: new Date('2026-09-09T08:00:00.000Z') },
    ])

    const bundle = await buildUserExport('user-1')

    expect(bundle.memoryEdges).toEqual([
      { from: '喜欢火锅', to: '每周五吃火锅', relation: 'similar', confidence: 'high', status: 'canonical', createdAt: '2026-09-09T00:00:00.000Z' },
      { from: '甲', to: '乙', relation: 'related', confidence: 'low', status: 'derived', createdAt: '2026-09-09T01:00:00.000Z' },
    ])
    expect(bundle.letters).toEqual([
      { weekStart: '2026-09-07T00:00:00.000Z', content: '信的内容', createdAt: '2026-09-09T08:00:00.000Z' },
    ])
  })

  it('记忆 tags 由 JSON 字符串还原为数组，日期序列化为 ISO 字符串', async () => {
    db.memoryFindMany.mockResolvedValue([
      { type: 'semantic', content: '喜欢火锅', importance: 8, tags: '["饮食","周末"]', origin: 'promoted', createdAt: new Date('2026-09-01T00:00:00.000Z') },
      { type: 'episodic', content: '无标签', importance: 5, tags: null, origin: 'manual', createdAt: new Date('2026-09-02T00:00:00.000Z') },
    ])

    const bundle = await buildUserExport('user-1')

    expect(bundle.memories).toEqual([
      { type: 'semantic', content: '喜欢火锅', importance: 8, tags: ['饮食', '周末'], origin: 'promoted', createdAt: '2026-09-01T00:00:00.000Z' },
      { type: 'episodic', content: '无标签', importance: 5, tags: [], origin: 'manual', createdAt: '2026-09-02T00:00:00.000Z' },
    ])
  })

  it('工作台派生理解纳入导出，evidence 由 JSON 字符串还原为数组', async () => {
    db.derivedFindMany.mockResolvedValue([
      {
        kind: 'pattern',
        content: '她习惯深夜学习',
        evidence: '["最近都学到凌晨","她说晚上效率高"]',
        confidence: 'medium',
        status: 'active',
        resolution: null,
        createdAt: new Date('2026-09-05T00:00:00.000Z'),
      },
      {
        kind: 'conflict',
        content: '她既想独居又想合住',
        evidence: null,
        confidence: 'low',
        status: 'resolved',
        resolution: '她想要的是独立书房',
        createdAt: new Date('2026-09-06T00:00:00.000Z'),
      },
    ])

    const bundle = await buildUserExport('user-1')

    expect(bundle.derivedInsights).toEqual([
      {
        kind: 'pattern',
        content: '她习惯深夜学习',
        evidence: ['最近都学到凌晨', '她说晚上效率高'],
        confidence: 'medium',
        status: 'active',
        resolution: null,
        createdAt: '2026-09-05T00:00:00.000Z',
      },
      {
        kind: 'conflict',
        content: '她既想独居又想合住',
        evidence: [],
        confidence: 'low',
        status: 'resolved',
        resolution: '她想要的是独立书房',
        createdAt: '2026-09-06T00:00:00.000Z',
      },
    ])
  })

  it('对话与消息嵌套导出，toolRuns 缺省为 null', async () => {
    db.conversationFindMany.mockResolvedValue([{
      title: 'Amie',
      mode: 'chat',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-02T00:00:00.000Z'),
      messages: [
        { role: 'user', content: '', emotion: null, source: null, importance: 3, toolRuns: null, imageExt: '.jpg', createdAt: new Date('2026-09-01T01:00:00.000Z') },
        { role: 'assistant', content: '记好了', emotion: 'neutral', source: 'qwen', importance: 3, toolRuns: [{ tool: 'add_todo', ok: true, summary: '已添加' }], createdAt: new Date('2026-09-01T01:00:01.000Z') },
      ],
    }])

    const bundle = await buildUserExport('user-1')

    expect(bundle.conversations).toHaveLength(1)
    expect(bundle.conversations[0].messages).toHaveLength(2)
    // 图片消息：导出只带 hasImage 标记，二进制不落包（v1 边界）
    expect(bundle.conversations[0].messages[0]).toMatchObject({ content: '', hasImage: true })
    expect(bundle.conversations[0].messages[0].imageExt).toBeUndefined()
    expect(bundle.conversations[0].messages[1]).toMatchObject({
      role: 'assistant',
      source: 'qwen',
      toolRuns: [{ tool: 'add_todo', ok: true, summary: '已添加' }],
      hasImage: false,
    })
  })

  it('手帐打卡与阅读按嵌套结构导出', async () => {
    db.habitFindMany.mockResolvedValue([{
      name: '喝水',
      icon: 'droplets',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      checkins: [{ day: new Date('2026-09-03T00:00:00.000Z'), createdAt: new Date('2026-09-03T08:00:00.000Z') }],
    }])
    db.bookFindMany.mockResolvedValue([{
      title: '活着',
      author: '余华',
      status: 'reading',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      notes: [{ content: '有庆那段看得心里发紧', aiComment: '我在', createdAt: new Date('2026-09-02T00:00:00.000Z') }],
    }])

    const bundle = await buildUserExport('user-1')

    expect(bundle.habits[0].checkins).toHaveLength(1)
    expect(bundle.books[0].notes[0]).toMatchObject({ content: '有庆那段看得心里发紧' })
  })

  it('用户不存在时 user 段为 null 但包仍完整', async () => {
    db.userFindUnique.mockResolvedValue(null)

    const bundle = await buildUserExport('ghost')

    expect(bundle.user).toBeNull()
    expect(bundle.memories).toEqual([])
    expect(bundle.version).toBe(EXPORT_VERSION)
  })
})
