import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  messageCount: vi.fn(),
  memoryFindMany: vi.fn(),
  memoryCount: vi.fn(),
  derivedCount: vi.fn(),
  edgeFindMany: vi.fn(),
  edgeCount: vi.fn(),
  sessionCount: vi.fn(),
  diaryFindMany: vi.fn(),
  checkinCount: vi.fn(),
  countdownFindFirst: vi.fn(),
  letterFindUnique: vi.fn(),
  letterCreate: vi.fn(),
  letterFindMany: vi.fn(),
  letterFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  listHabitsWithStatus: vi.fn(),
  getStudySummary: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    message: { count: mocks.messageCount },
    memory: { findMany: mocks.memoryFindMany, count: mocks.memoryCount },
    derivedInsight: { count: mocks.derivedCount },
    memoryEdge: { findMany: mocks.edgeFindMany, count: mocks.edgeCount },
    studySession: { count: mocks.sessionCount },
    diaryEntry: { findMany: mocks.diaryFindMany },
    habitCheckin: { count: mocks.checkinCount },
    countdown: { findFirst: mocks.countdownFindFirst },
    letter: { findUnique: mocks.letterFindUnique, findFirst: mocks.letterFindFirst, create: mocks.letterCreate, findMany: mocks.letterFindMany },
    user: { findUnique: mocks.userFindUnique },
  },
}))
vi.mock('./habitService.js', () => ({ listHabitsWithStatus: mocks.listHabitsWithStatus }))
vi.mock('./studyService.js', () => ({ getSummary: mocks.getStudySummary }))
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  collectWeekStats,
  composeLetter,
  generateWeeklyLetter,
  getLetter,
  isQuietWeek,
  listLetters,
  localWeekStartUtc,
} from './letterService.js'

const USER_ID = 'user-1'
const WEEK_START = new Date('2026-09-07T00:00:00.000Z')
const NOW = new Date(2026, 8, 9, 12, 0, 0) // 周三中午

const FULL_STATS = {
  messageCount: 23,
  memoryCount: 4,
  memoryContents: ['喜欢火锅', '准备英语面试', '周五聚餐'],
  promotedCount: 2,
  edgeCount: 1,
  edges: [{ from: '喜欢火锅', to: '每周五吃火锅', relation: 'similar' }],
  bestHabit: { name: '喝水', streak: 12 },
  todayHabitsDone: 1,
  weekMinutes: 85,
  studySessionCount: 3,
  moodCounts: { happy: 3, sad: 1 },
  diaryDays: 4,
  checkinCount: 9,
  upcomingCountdown: { title: '英语面试', targetDate: new Date(2026, 8, 13) },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.messageCount.mockResolvedValue(0)
  mocks.memoryFindMany.mockResolvedValue([])
  mocks.memoryCount.mockResolvedValue(0)
  mocks.derivedCount.mockResolvedValue(0)
  mocks.edgeFindMany.mockResolvedValue([])
  mocks.edgeCount.mockResolvedValue(0)
  mocks.sessionCount.mockResolvedValue(0)
  mocks.diaryFindMany.mockResolvedValue([])
  mocks.checkinCount.mockResolvedValue(0)
  mocks.countdownFindFirst.mockResolvedValue(null)
  mocks.letterFindUnique.mockResolvedValue(null)
  mocks.letterFindFirst.mockResolvedValue(null)
  mocks.letterCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'letter-1', ...data, createdAt: NOW }))
  mocks.letterFindMany.mockResolvedValue([])
  mocks.userFindUnique.mockResolvedValue({ nickname: '小赛' })
  mocks.listHabitsWithStatus.mockResolvedValue([])
  mocks.getStudySummary.mockResolvedValue({ streak: 0, todayMinutes: 0, weekMinutes: 0, totalSessions: 0 })
})

describe('localWeekStartUtc', () => {
  it('周三归到本周一，周一归自身，周日归上周一', () => {
    expect(localWeekStartUtc(new Date(2026, 8, 9))).toEqual(WEEK_START)
    expect(localWeekStartUtc(new Date(2026, 8, 7))).toEqual(WEEK_START)
    expect(localWeekStartUtc(new Date(2026, 8, 13))).toEqual(WEEK_START)
    expect(localWeekStartUtc(new Date(2026, 8, 14))).toEqual(new Date('2026-09-14T00:00:00.000Z'))
  })
})

describe('composeLetter', () => {
  it('全量统计生成全部段落，引用与关系逐字出现', () => {
    const content = composeLetter({ nickname: ' 小赛 ', stats: FULL_STATS, now: NOW })

    expect(content).toContain('小赛，见信好。')
    expect(content).toContain('这周你们聊了 23 轮')
    expect(content).toContain('新记下了 4 件事：「喜欢火锅」「准备英语面试」「周五聚餐」，等等')
    expect(content).toContain('工作台里有 2 条理解被你定了下来')
    expect(content).toContain('你还确认了 1 条关系：「喜欢火锅」—相似→「每周五吃火锅」')
    expect(content).toContain('打卡最好的是「喝水」，连续 12 天')
    expect(content).toContain('自习一共 85 分钟')
    expect(content).toContain('心情上：开心 3 天、难过 1 天')
    expect(content).toContain('不太好的时候，想说的时候我都在')
    expect(content).toContain('「英语面试」还有 4 天')
    expect(content.endsWith('—— 你的姐妹')).toBe(true)
  })

  it('只有聊天轮数时其余段落整段缺席', () => {
    const content = composeLetter({
      nickname: null,
      stats: { ...FULL_STATS, memoryCount: 0, memoryContents: [], promotedCount: 0, edgeCount: 0, edges: [], bestHabit: null, weekMinutes: 0, moodCounts: {}, diaryDays: 0, upcomingCountdown: null },
      now: NOW,
    })

    expect(content).toBe('见信好。\n\n这周你们聊了 23 轮。\n\n—— 你的姐妹')
  })

  it('零聊天时的诚实表述与沉重心情追加', () => {
    const content = composeLetter({
      nickname: null,
      stats: { ...FULL_STATS, messageCount: 0, moodCounts: { anxious: 2 } },
      now: NOW,
    })

    expect(content).toContain('这周你们没怎么聊，没关系，我一直在')
    expect(content).toContain('心情上：焦虑 2 天。不太好的时候，想说的时候我都在')
  })
})

describe('isQuietWeek', () => {
  it('任一活动即非沉默周', () => {
    const quiet = { messageCount: 0, memoryCount: 0, checkinCount: 0, studySessionCount: 0, diaryDays: 0 }
    expect(isQuietWeek(quiet)).toBe(true)
    expect(isQuietWeek({ ...quiet, messageCount: 1 })).toBe(false)
    expect(isQuietWeek({ ...quiet, checkinCount: 1 })).toBe(false)
    expect(isQuietWeek({ ...quiet, diaryDays: 1 })).toBe(false)
  })
})

describe('generateWeeklyLetter', () => {
  it('本周信已存在时直接返回，不再收集统计', async () => {
    const existing = { id: 'letter-9', userId: USER_ID, weekStart: WEEK_START, content: '旧信' }
    mocks.letterFindUnique.mockResolvedValue(existing)

    const result = await generateWeeklyLetter(USER_ID, { weekStartUtc: WEEK_START })

    expect(result).toEqual({ letter: existing, created: false })
    expect(mocks.messageCount).not.toHaveBeenCalled()
    expect(mocks.letterCreate).not.toHaveBeenCalled()
  })

  it('沉默周不生成，返回 quiet', async () => {
    const result = await generateWeeklyLetter(USER_ID, { weekStartUtc: WEEK_START })

    expect(result).toEqual({ letter: null, created: false, reason: 'quiet' })
    expect(mocks.letterCreate).not.toHaveBeenCalled()
    expect(mocks.userFindUnique).not.toHaveBeenCalled()
  })

  it('有活动时组信落库并返回 created', async () => {
    mocks.messageCount.mockResolvedValue(23)
    mocks.memoryCount.mockResolvedValue(1)
    mocks.memoryFindMany.mockResolvedValue([{ content: '喜欢火锅' }])

    const result = await generateWeeklyLetter(USER_ID, { weekStartUtc: WEEK_START })

    expect(result.created).toBe(true)
    const data = mocks.letterCreate.mock.calls[0][0].data
    expect(data).toMatchObject({ userId: USER_ID, weekStart: WEEK_START })
    expect(data.content).toContain('小赛，见信好。')
    expect(data.content).toContain('23 轮')
    expect(data.content).toContain('新记下了 1 件事：「喜欢火锅」')
  })

  it('并发生成撞唯一约束（P2002）时回读既有的信', async () => {
    mocks.messageCount.mockResolvedValue(3)
    const existing = { id: 'letter-9', content: '并发那一封' }
    mocks.letterCreate.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
    mocks.letterFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing)

    const result = await generateWeeklyLetter(USER_ID, { weekStartUtc: WEEK_START })

    expect(result).toEqual({ letter: existing, created: false })
  })
})

describe('listLetters / getLetter', () => {
  it('列表前先幂等补本周信，按周起始倒序返回', async () => {
    mocks.messageCount.mockResolvedValue(1)
    mocks.letterFindMany.mockResolvedValue([
      { id: 'l2', weekStart: new Date('2026-09-14T00:00:00.000Z'), content: '本周' },
      { id: 'l1', weekStart: WEEK_START, content: '上周' },
    ])

    const letters = await listLetters(USER_ID)

    expect(mocks.letterCreate).toHaveBeenCalled()
    expect(letters.map((letter) => letter.id)).toEqual(['l2', 'l1'])
    expect(mocks.letterFindMany).toHaveBeenCalledWith({ where: { userId: USER_ID }, orderBy: { weekStart: 'desc' } })
  })

  it('读取非本人信件抛 404', async () => {
    await expect(getLetter(USER_ID, 'nope')).rejects.toMatchObject({ statusCode: 404, message: '信件不存在' })
  })
})
