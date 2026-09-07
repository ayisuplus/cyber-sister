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
      externalLlmConsentVersion: 'cloud-primary-v1',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    })
    for (const key of [
      'memoryFindMany', 'conversationFindMany', 'todoFindMany', 'countdownFindMany',
      'periodFindMany', 'reminderFindMany', 'diaryFindMany', 'habitFindMany',
      'bookFindMany', 'studyFindMany',
    ]) {
      db[key].mockResolvedValue([])
    }
  })

  it('导出包带版本号与产品标识，user 段不含内部 id 与凭据字段', async () => {
    const bundle = await buildUserExport('user-1')

    expect(bundle.version).toBe(EXPORT_VERSION)
    expect(bundle.product).toBe('赛博姐妹 cyber-sister')
    expect(typeof bundle.exportedAt).toBe('string')
    expect(bundle.user).toMatchObject({ nickname: '小赛', persona: 'toxic', roleName: '同桌的你' })
    expect(JSON.stringify(bundle.user)).not.toContain('phone')
    expect(JSON.stringify(bundle.user)).not.toContain('password')
    expect(JSON.stringify(bundle)).not.toContain('refreshToken')
  })

  it('全部 11 张表按当前用户过滤查询', async () => {
    await buildUserExport('user-1')

    for (const key of [
      'memoryFindMany', 'conversationFindMany', 'todoFindMany', 'countdownFindMany',
      'periodFindMany', 'reminderFindMany', 'diaryFindMany', 'habitFindMany',
      'bookFindMany', 'studyFindMany',
    ]) {
      expect(db[key]).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId: 'user-1' },
      }))
    }
  })

  it('记忆 tags 由 JSON 字符串还原为数组，日期序列化为 ISO 字符串', async () => {
    db.memoryFindMany.mockResolvedValue([
      { type: 'semantic', content: '喜欢火锅', importance: 8, tags: '["饮食","周末"]', createdAt: new Date('2026-09-01T00:00:00.000Z') },
      { type: 'episodic', content: '无标签', importance: 5, tags: null, createdAt: new Date('2026-09-02T00:00:00.000Z') },
    ])

    const bundle = await buildUserExport('user-1')

    expect(bundle.memories).toEqual([
      { type: 'semantic', content: '喜欢火锅', importance: 8, tags: ['饮食', '周末'], createdAt: '2026-09-01T00:00:00.000Z' },
      { type: 'episodic', content: '无标签', importance: 5, tags: [], createdAt: '2026-09-02T00:00:00.000Z' },
    ])
  })

  it('对话与消息嵌套导出，toolRuns 缺省为 null', async () => {
    db.conversationFindMany.mockResolvedValue([{
      title: '赛博姐妹',
      mode: 'chat',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-02T00:00:00.000Z'),
      messages: [
        { role: 'user', content: '帮我记个待办', emotion: null, source: null, importance: 3, toolRuns: null, createdAt: new Date('2026-09-01T01:00:00.000Z') },
        { role: 'assistant', content: '记好了', emotion: 'neutral', source: 'qwen', importance: 3, toolRuns: [{ tool: 'add_todo', ok: true, summary: '已添加' }], createdAt: new Date('2026-09-01T01:00:01.000Z') },
      ],
    }])

    const bundle = await buildUserExport('user-1')

    expect(bundle.conversations).toHaveLength(1)
    expect(bundle.conversations[0].messages).toHaveLength(2)
    expect(bundle.conversations[0].messages[1]).toMatchObject({
      role: 'assistant',
      source: 'qwen',
      toolRuns: [{ tool: 'add_todo', ok: true, summary: '已添加' }],
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
