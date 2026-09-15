import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  messageCount: vi.fn(),
  memoryFindMany: vi.fn(),
  memoryCount: vi.fn(),
  derivedCount: vi.fn(),
  edgeFindMany: vi.fn(),
  edgeCount: vi.fn(),
  diaryFindMany: vi.fn(),
  readingNoteCount: vi.fn(),
  taskFindMany: vi.fn(),
  taskCount: vi.fn(),
  taskFindFirst: vi.fn(),
  letterFindUnique: vi.fn(),
  letterCreate: vi.fn(),
  letterFindMany: vi.fn(),
  letterFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    message: { count: mocks.messageCount },
    memory: { findMany: mocks.memoryFindMany, count: mocks.memoryCount },
    derivedInsight: { count: mocks.derivedCount },
    memoryEdge: { findMany: mocks.edgeFindMany, count: mocks.edgeCount },
    diaryEntry: { findMany: mocks.diaryFindMany },
    readingNote: { count: mocks.readingNoteCount },
    scheduledReminder: { findMany: mocks.taskFindMany, count: mocks.taskCount, findFirst: mocks.taskFindFirst },
    letter: { findUnique: mocks.letterFindUnique, findFirst: mocks.letterFindFirst, create: mocks.letterCreate, findMany: mocks.letterFindMany },
    user: { findUnique: mocks.userFindUnique },
  },
}))
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
  moodCounts: { happy: 3, sad: 1 },
  diaryDays: 4,
  readingNoteCount: 5,
  doneTaskCount: 4,
  doneTaskContents: ['复诊', '交房租', '寄快递'],
  upcomingTask: { content: '英语面试', nextFireAt: new Date(2026, 8, 13, 9, 0) },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.messageCount.mockResolvedValue(0)
  mocks.memoryFindMany.mockResolvedValue([])
  mocks.memoryCount.mockResolvedValue(0)
  mocks.derivedCount.mockResolvedValue(0)
  mocks.edgeFindMany.mockResolvedValue([])
  mocks.edgeCount.mockResolvedValue(0)
  mocks.diaryFindMany.mockResolvedValue([])
  mocks.readingNoteCount.mockResolvedValue(0)
  mocks.taskFindMany.mockResolvedValue([])
  mocks.taskCount.mockResolvedValue(0)
  mocks.taskFindFirst.mockResolvedValue(null)
  mocks.letterFindUnique.mockResolvedValue(null)
  mocks.letterFindFirst.mockResolvedValue(null)
  mocks.letterCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'letter-1', ...data, createdAt: NOW }))
  mocks.letterFindMany.mockResolvedValue([])
  mocks.userFindUnique.mockResolvedValue({ nickname: '小赛' })
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
    expect(content).toContain('待确认里有 2 条理解被你定了下来')
    expect(content).toContain('你还确认了 1 条关系：「喜欢火锅」—相似→「每周五吃火锅」')
    expect(content).toContain('这周做完了 4 件安排：「复诊」「交房租」「寄快递」，等等')
    expect(content).toContain('读书记了 5 条笔记')
    expect(content).toContain('心情上：开心 3 天、难过 1 天')
    expect(content).toContain('不太好的时候，想说的时候我都在')
    expect(content).toContain('「英语面试」还有 4 天')
    expect(content.endsWith('—— 你的姐妹')).toBe(true)
  })

  it('只有聊天轮数时其余段落整段缺席', () => {
    const content = composeLetter({
      nickname: null,
      stats: { ...FULL_STATS, memoryCount: 0, memoryContents: [], promotedCount: 0, edgeCount: 0, edges: [], moodCounts: {}, diaryDays: 0, readingNoteCount: 0, doneTaskCount: 0, doneTaskContents: [], upcomingTask: null },
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
    const quiet = { messageCount: 0, memoryCount: 0, diaryDays: 0, readingNoteCount: 0, doneTaskCount: 0 }
    expect(isQuietWeek(quiet)).toBe(true)
    expect(isQuietWeek({ ...quiet, messageCount: 1 })).toBe(false)
    expect(isQuietWeek({ ...quiet, diaryDays: 1 })).toBe(false)
    expect(isQuietWeek({ ...quiet, readingNoteCount: 1 })).toBe(false)
    expect(isQuietWeek({ ...quiet, doneTaskCount: 1 })).toBe(false)
  })
})

describe('collectWeekStats', () => {
  it('生活素材来自日记、读书笔记和本周做完的安排；往前看只取两周内带日子的安排', async () => {
    mocks.diaryFindMany.mockResolvedValue([{ mood: 'happy' }, { mood: 'happy' }, { mood: 'sad' }])
    mocks.readingNoteCount.mockResolvedValue(2)
    mocks.taskFindMany.mockResolvedValue([{ content: '复诊' }])
    mocks.taskCount.mockResolvedValue(1)
    mocks.taskFindFirst.mockResolvedValue({ content: '英语面试', nextFireAt: new Date(2026, 8, 13, 9) })

    const stats = await collectWeekStats(USER_ID, WEEK_START, NOW)

    expect(stats).toMatchObject({
      moodCounts: { happy: 2, sad: 1 }, diaryDays: 3, readingNoteCount: 2,
      doneTaskCount: 1, doneTaskContents: ['复诊'], upcomingTask: { content: '英语面试' },
    })
    const doneThisWeek = { userId: USER_ID, status: 'done', updatedAt: { gte: WEEK_START } }
    expect(mocks.taskCount).toHaveBeenCalledWith({ where: doneThisWeek })
    expect(mocks.taskFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: doneThisWeek, take: 3 }))
    expect(mocks.taskFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: USER_ID, status: 'active', instruction: null, freq: { in: ['once', 'yearly'] },
        nextFireAt: { gte: NOW, lte: new Date(NOW.getTime() + 14 * 24 * 60 * 60 * 1000) },
      },
    }))
  })
})

describe('generateWeeklyLetter mock boundary', () => {
  it('returns a labelled preview without reading private context or creating a letter', async () => {
    mocks.messageCount.mockResolvedValue(23)
    const result = await generateWeeklyLetter(USER_ID, { weekStartUtc: WEEK_START })
    expect(result).toMatchObject({ letter: null, created: false, reason: 'cloud_mock', execution: { mode: 'mock', cloudConnected: false, persisted: false } })
    expect(result.preview.content).toContain('模拟')
    expect(mocks.messageCount).not.toHaveBeenCalled()
    expect(mocks.memoryFindMany).not.toHaveBeenCalled()
    expect(mocks.userFindUnique).not.toHaveBeenCalled()
    expect(mocks.letterCreate).not.toHaveBeenCalled()
    expect(mocks.letterFindUnique).not.toHaveBeenCalled()
  })
})

describe('listLetters / getLetter', () => {
  it('列表仅读取既有信件，绝不隐式生成或写入', async () => {
    mocks.messageCount.mockResolvedValue(1)
    mocks.letterFindMany.mockResolvedValue([
      { id: 'l2', weekStart: new Date('2026-09-14T00:00:00.000Z'), content: '本周' },
      { id: 'l1', weekStart: WEEK_START, content: '上周' },
    ])

    const letters = await listLetters(USER_ID)

    expect(mocks.letterCreate).not.toHaveBeenCalled()
    expect(mocks.messageCount).not.toHaveBeenCalled()
    expect(letters.map((letter) => letter.id)).toEqual(['l2', 'l1'])
    expect(mocks.letterFindMany).toHaveBeenCalledWith({ where: { userId: USER_ID }, orderBy: { weekStart: 'desc' } })
  })

  it('读取非本人信件抛 404', async () => {
    await expect(getLetter(USER_ID, 'nope')).rejects.toMatchObject({ statusCode: 404, message: '信件不存在' })
  })
})
