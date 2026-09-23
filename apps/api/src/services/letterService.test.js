import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  messageCount: vi.fn(),
  memoryFindMany: vi.fn(),
  memoryCount: vi.fn(),
  derivedCount: vi.fn(),
  derivedFindMany: vi.fn(),
  derivedUpdateMany: vi.fn(),
  edgeFindMany: vi.fn(),
  edgeCount: vi.fn(),
  edgeUpdateMany: vi.fn(),
  diaryFindMany: vi.fn(),
  readingNoteCount: vi.fn(),
  bookFindFirst: vi.fn(),
  taskFindMany: vi.fn(),
  taskCount: vi.fn(),
  taskFindFirst: vi.fn(),
  letterFindFirst: vi.fn(),
  letterCreate: vi.fn(),
  letterFindMany: vi.fn(),
  letterUpdateMany: vi.fn(),
  userFindUnique: vi.fn(),
  gatewayComplete: vi.fn(),
  runAnalysis: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    message: { count: mocks.messageCount },
    memory: { findMany: mocks.memoryFindMany, count: mocks.memoryCount },
    derivedInsight: { count: mocks.derivedCount, findMany: mocks.derivedFindMany, updateMany: mocks.derivedUpdateMany },
    memoryEdge: { findMany: mocks.edgeFindMany, count: mocks.edgeCount, updateMany: mocks.edgeUpdateMany },
    diaryEntry: { findMany: mocks.diaryFindMany },
    readingNote: { count: mocks.readingNoteCount },
    book: { findFirst: mocks.bookFindFirst },
    scheduledReminder: { findMany: mocks.taskFindMany, count: mocks.taskCount, findFirst: mocks.taskFindFirst },
    letter: { findFirst: mocks.letterFindFirst, create: mocks.letterCreate, findMany: mocks.letterFindMany, updateMany: mocks.letterUpdateMany },
    user: { findUnique: mocks.userFindUnique },
  },
}))
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('./llmService.js', () => ({
  assertCloudCallable: vi.fn((allowExternal) => { if (!allowExternal) throw new Error('not consented') }),
  getGateway: vi.fn(() => Promise.resolve({ complete: mocks.gatewayComplete })),
}))
vi.mock('./userService.js', () => ({ loadExternalConsent: vi.fn() }))
vi.mock('./derivedService.js', () => ({ runAnalysis: mocks.runAnalysis }))
vi.mock('./contextBlocks.js', () => ({
  localClock: (date) => {
    const value = new Date(date)
    return {
      year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate(),
      weekday: value.getDay(), dayKey: Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()),
    }
  },
}))

import { loadExternalConsent } from './userService.js'
import {
  cleanLetterBody,
  collectPeriodStats,
  composeLetterLocal,
  extractJsonObject,
  findLatestLetter,
  generateDueLetter,
  getLetter,
  isQuietPeriod,
  listLetters,
  markLetterRead,
  periodStartOf,
  sanitizeSuggestions,
} from './letterService.js'

const USER_ID = 'user-1'
const NOW = new Date(2026, 8, 9, 12, 0, 0) // 2026-09-09 中午（本地）
const PERIOD_START = new Date('2026-09-09T00:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

const CONSENTED = { allowExternal: true, authorizeExternal: async () => true }
const NOT_CONSENTED = { allowExternal: false, authorizeExternal: undefined }

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
  readingBookTitle: '小王子',
  doneTaskCount: 4,
  doneTaskContents: ['交稿', '交房租', '寄快递'],
  upcomingTask: { content: '英语面试', nextFireAt: new Date(2026, 8, 13, 9, 0) },
}
const QUIET_STATS = {
  messageCount: 0, memoryCount: 0, memoryContents: [], promotedCount: 0, edgeCount: 0, edges: [],
  moodCounts: {}, diaryDays: 0, readingNoteCount: 0, readingBookTitle: '', doneTaskCount: 0,
  doneTaskContents: [], upcomingTask: null,
}

const MEMORY = { id: 'm1', revision: 3, content: '喜欢桂花味的咖啡' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.messageCount.mockResolvedValue(0)
  mocks.memoryFindMany.mockResolvedValue([])
  mocks.memoryCount.mockResolvedValue(0)
  mocks.derivedCount.mockResolvedValue(0)
  mocks.derivedFindMany.mockResolvedValue([])
  mocks.derivedUpdateMany.mockResolvedValue({ count: 0 })
  mocks.edgeFindMany.mockResolvedValue([])
  mocks.edgeCount.mockResolvedValue(0)
  mocks.edgeUpdateMany.mockResolvedValue({ count: 0 })
  mocks.diaryFindMany.mockResolvedValue([])
  mocks.readingNoteCount.mockResolvedValue(0)
  mocks.bookFindFirst.mockResolvedValue(null)
  mocks.taskFindMany.mockResolvedValue([])
  mocks.taskCount.mockResolvedValue(0)
  mocks.taskFindFirst.mockResolvedValue(null)
  mocks.letterFindFirst.mockResolvedValue(null)
  mocks.letterFindMany.mockResolvedValue([])
  mocks.letterCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'letter-1', ...data, createdAt: NOW }))
  mocks.userFindUnique.mockResolvedValue({ nickname: '小晴', persona: 'gentle', letterFreqDays: 3 })
  mocks.runAnalysis.mockResolvedValue({ created: 0, skipped: 0 })
  loadExternalConsent.mockResolvedValue(NOT_CONSENTED)
})

const withStats = () => {
  mocks.messageCount.mockResolvedValue(FULL_STATS.messageCount)
  mocks.memoryFindMany.mockResolvedValue(FULL_STATS.memoryContents.map((content) => ({ content })))
  mocks.memoryCount.mockResolvedValue(FULL_STATS.memoryCount)
  mocks.diaryFindMany.mockResolvedValue([{ mood: 'happy' }, { mood: 'happy' }, { mood: 'happy' }, { mood: 'sad' }])
  mocks.readingNoteCount.mockResolvedValue(FULL_STATS.readingNoteCount)
  mocks.bookFindFirst.mockResolvedValue({ title: '小王子' })
  mocks.taskFindMany.mockResolvedValue(FULL_STATS.doneTaskContents.map((content) => ({ content })))
  mocks.taskCount.mockResolvedValue(FULL_STATS.doneTaskCount)
  mocks.taskFindFirst.mockResolvedValue(FULL_STATS.upcomingTask)
}

describe('periodStartOf', () => {
  it('当天本地日按 UTC 零点记（同日记/经期契约）', () => {
    expect(periodStartOf(NOW)).toEqual(PERIOD_START)
    expect(periodStartOf(new Date(2026, 8, 9, 23, 59))).toEqual(PERIOD_START)
    expect(periodStartOf(new Date(2026, 8, 10, 0, 1))).toEqual(new Date('2026-09-10T00:00:00.000Z'))
  })
})

describe('generateDueLetter：到期判定', () => {
  it('三天一封且上封是 3 天前 → 到期生成，落库 freqDays=3', async () => {
    withStats()
    mocks.letterFindFirst.mockResolvedValue({ id: 'l0', periodStart: new Date(NOW.getTime() - 3 * DAY_MS), content: '上一封' })

    const { letter, created } = await generateDueLetter(USER_ID, { now: NOW })

    expect(created).toBe(true)
    expect(mocks.letterCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: USER_ID, periodStart: PERIOD_START, freqDays: 3, content: expect.any(String) }),
    })
    expect(letter.content).toContain('小晴，见信好。')
  })

  it('没到期只回最新一封，不写库', async () => {
    const latest = { id: 'l0', periodStart: new Date(NOW.getTime() - 2 * DAY_MS), content: '上一封' }
    mocks.letterFindFirst.mockResolvedValue(latest)

    expect(await generateDueLetter(USER_ID, { now: NOW })).toEqual({ letter: latest, created: false, reason: 'not_due' })
    expect(mocks.letterCreate).not.toHaveBeenCalled()
    expect(mocks.messageCount).not.toHaveBeenCalled()
  })

  it('没开写信（letterFreqDays 为空）→ reason: off，不写库', async () => {
    mocks.userFindUnique.mockResolvedValue({ nickname: '小晴', persona: 'gentle', letterFreqDays: null })

    expect(await generateDueLetter(USER_ID, { now: NOW })).toEqual({ letter: null, created: false, reason: 'off' })
    expect(mocks.letterCreate).not.toHaveBeenCalled()
  })

  it('窗口内零数据且无草稿 → reason: quiet，不写也不留空信', async () => {
    expect(await generateDueLetter(USER_ID, { now: NOW })).toEqual({ letter: null, created: false, reason: 'quiet' })
    expect(mocks.letterCreate).not.toHaveBeenCalled()
  })

  it('create 撞 P2002 → 回读返回 created: false', async () => {
    withStats()
    mocks.letterCreate.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
    mocks.letterFindFirst
      .mockResolvedValueOnce(null) // 最新一封：从没写过信
      .mockResolvedValueOnce({ id: 'l-winner', periodStart: PERIOD_START, content: '别的请求刚写好的' })

    expect(await generateDueLetter(USER_ID, { now: NOW })).toEqual({
      letter: { id: 'l-winner', periodStart: PERIOD_START, content: '别的请求刚写好的' }, created: false,
    })
    expect(mocks.derivedUpdateMany).not.toHaveBeenCalled()
  })
})

describe('generateDueLetter：云端组信与服务端校验', () => {
  const modelOutput = {
    letter: '见信好。\n\n我看着你把「桂花味的咖啡」改成了新说法。\n\n—— 你的姐妹',
    suggestions: [
      {
        kind: 'edit_memory', title: '改一下这条记忆', memoryId: 'm1', quote: '桂花味', suggestText: '喜欢桂花味的拿铁',
        instruction: null, planDate: null, chatText: '就按你信里说的改吧',
      },
      { kind: 'delete_memory', title: '删掉旧说法', memoryId: 'm1', quote: '咖啡', suggestText: '', chatText: null },
    ],
  }

  beforeEach(() => {
    loadExternalConsent.mockResolvedValue(CONSENTED)
    withStats()
    // 记忆摘要（take=5）给建议用，窗口新记忆（take=3）给近况用
    mocks.memoryFindMany.mockImplementation(({ take }) => Promise.resolve(
      take === 5 ? [MEMORY] : FULL_STATS.memoryContents.map((content) => ({ content })),
    ))
    mocks.derivedFindMany.mockResolvedValue([{
      id: 'd1', kind: 'pattern', content: '你常在周末爬山', evidence: JSON.stringify(['周末去爬山']), sources: [],
    }])
  })

  it('同意云端 → 先回想，模型建议过校验后落库，草稿消费掉', async () => {
    mocks.gatewayComplete.mockResolvedValue({ content: JSON.stringify(modelOutput) })

    const { letter, created } = await generateDueLetter(USER_ID, { now: NOW })

    expect(mocks.runAnalysis).toHaveBeenCalledWith(USER_ID, `letter:${PERIOD_START.toISOString()}`, { consent: CONSENTED, now: NOW })
    expect(created).toBe(true)
    expect(mocks.letterCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        content: modelOutput.letter,
        suggestions: [
          expect.objectContaining({ kind: 'edit_memory', memoryId: 'm1', memoryRevision: 3, decided: null, quote: '桂花味' }),
          expect.objectContaining({ kind: 'delete_memory', memoryId: 'm1', memoryRevision: 3, decided: null, suggestText: '' }),
        ],
      }),
    })
    expect(letter.suggestions[0].decided).toBeNull()
    // 素材草稿用完即消费，不重复出现在下一封
    expect(mocks.derivedUpdateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: { in: ['d1'] } },
      data: { status: 'dismissed', resolution: `lettered:${PERIOD_START.toISOString()}` },
    })
  })

  it('quote 不是记忆原文子串、或字段含敏感内容的条目被丢，超量只留 3 条', () => {
    const suggestions = sanitizeSuggestions([
      { kind: 'edit_memory', title: '改', memoryId: 'm1', quote: '杜撰的引文', suggestText: '新说法' },
      { kind: 'edit_memory', title: '改', memoryId: 'm1', quote: '桂花味', suggestText: '新说法含月经期' },
      { kind: 'plan', title: '月经期安排', suggestText: '事' },
      ...[1, 2, 3, 4].map((n) => ({ kind: 'plan', title: `安排${n}`, suggestText: `事情${n}` })),
    ], new Map([[MEMORY.id, MEMORY]]))

    expect(suggestions.map((suggestion) => suggestion.title)).toEqual(['安排1', '安排2', '安排3'])
  })

  it('模型返回非 JSON → 整体降级本地模板信，suggestions 为空', async () => {
    mocks.gatewayComplete.mockResolvedValue({ content: '我觉得她挺好的' })

    const { letter, created } = await generateDueLetter(USER_ID, { now: NOW })

    expect(created).toBe(true)
    expect(letter.content).toContain('小晴，见信好。')
    expect(letter.suggestions).toEqual([])
  })

  it('回想失败只记日志，写信照常', async () => {
    mocks.runAnalysis.mockRejectedValue(new Error('analysis down'))
    mocks.gatewayComplete.mockResolvedValue({ content: JSON.stringify(modelOutput) })

    expect((await generateDueLetter(USER_ID, { now: NOW })).created).toBe(true)
    expect(mocks.letterCreate).toHaveBeenCalled()
  })
})

describe('generateDueLetter：未同意云端', () => {
  it('不回想、不调网关，直接本地模板信且 suggestions 为空', async () => {
    withStats()

    const { letter, created } = await generateDueLetter(USER_ID, { now: NOW })

    expect(created).toBe(true)
    expect(mocks.runAnalysis).not.toHaveBeenCalled()
    expect(mocks.gatewayComplete).not.toHaveBeenCalled()
    expect(letter.suggestions).toEqual([])
    expect(letter.content).toContain('小晴，见信好。')
  })
})

describe('composeLetterLocal', () => {
  it('全量统计生成全部段落，引用逐字出现；看法用草稿原句与新记忆引述', () => {
    const { content, suggestions } = composeLetterLocal({
      nickname: ' 小晴 ', persona: 'gentle', stats: FULL_STATS,
      drafts: { insights: [{ id: 'd1', kind: 'pattern', content: '你常在周末爬山', evidence: [] }], edges: [] },
      now: NOW,
    })

    expect(content).toContain('小晴，见信好。')
    expect(content).toContain('我们聊了 23 轮')
    expect(content).toContain('新记下了 4 件事：「喜欢火锅」「准备英语面试」「周五聚餐」，等等')
    expect(content).toContain('做完了 4 件事：「交稿」「交房租」「寄快递」，等等')
    expect(content).toContain('读书记了 5 条笔记')
    expect(content).toContain('心情上：开心 3 天、难过 1 天')
    expect(content).toContain('不太好的时候，想说的时候我都在')
    expect(content).toContain('「英语面试」还有 4 天')
    expect(content).toContain('你又让我多懂了你一点：「你常在周末爬山」')
    expect(content).toContain('你新记下的「喜欢火锅」')
    expect(content).toContain('说起来，交稿这事办得漂亮')
    expect(content.endsWith('—— 你的姐妹')).toBe(true)
    // 模板不发明建议
    expect(suggestions).toEqual([])
  })

  it('没有素材的段整段缺席，打趣段无据时不在', () => {
    const { content } = composeLetterLocal({
      nickname: null, persona: 'gentle',
      stats: { ...QUIET_STATS, messageCount: 23 },
      drafts: { insights: [], edges: [] }, now: NOW,
    })

    expect(content).toBe('见信好。\n\n我们聊了 23 轮。\n\n—— 你的姐妹')
  })

  it('用她当前的说话方式写，事实不变；不认识的说话方式按温柔', () => {
    const letter = (persona) => composeLetterLocal({
      nickname: '小晴', persona, stats: { ...FULL_STATS, moodCounts: { sad: 1 } },
      drafts: { insights: [], edges: [] }, now: NOW,
    }).content
    expect(letter('toxic')).toContain('小晴，来信了。')
    expect(letter('toxic')).toContain('不爽的时候别憋着，来找我')
    expect(letter('toxic')).toContain('哦对，交稿——行啊你，别飘。')
    expect(letter('cool')).toContain('小晴：')
    expect(letter('cool')).toContain('交稿。挺好。')
    for (const persona of ['gentle', 'toxic', 'cool']) {
      expect(letter(persona)).toContain('我们聊了 23 轮')
      expect(letter(persona)).toContain('「英语面试」还有 4 天')
    }
    expect(letter('energetic')).toBe(letter('gentle'))
    expect(new Set(['gentle', 'toxic', 'cool'].map(letter)).size).toBe(3)
  })
})

describe('isQuietPeriod', () => {
  it('任一活动或草稿即非沉默期', () => {
    const quiet = { insights: [], edges: [] }
    expect(isQuietPeriod(QUIET_STATS, quiet)).toBe(true)
    expect(isQuietPeriod({ ...QUIET_STATS, messageCount: 1 }, quiet)).toBe(false)
    expect(isQuietPeriod({ ...QUIET_STATS, diaryDays: 1 }, quiet)).toBe(false)
    expect(isQuietPeriod({ ...QUIET_STATS, readingNoteCount: 1 }, quiet)).toBe(false)
    expect(isQuietPeriod({ ...QUIET_STATS, doneTaskCount: 1 }, quiet)).toBe(false)
    expect(isQuietPeriod(QUIET_STATS, { insights: [{ id: 'd1' }], edges: [] })).toBe(false)
    expect(isQuietPeriod(QUIET_STATS, { insights: [], edges: [{ id: 'e1' }] })).toBe(false)
  })
})

describe('collectPeriodStats', () => {
  it('生活素材来自日记、读书笔记和窗口内做完的安排；往前看只取两周内带日子的安排', async () => {
    mocks.diaryFindMany.mockResolvedValue([{ mood: 'happy' }, { mood: 'happy' }, { mood: 'sad' }])
    mocks.readingNoteCount.mockResolvedValue(2)
    mocks.bookFindFirst.mockResolvedValue({ title: '小王子' })
    mocks.taskFindMany.mockResolvedValue([{ content: '交房租' }])
    mocks.taskCount.mockResolvedValue(1)
    mocks.taskFindFirst.mockResolvedValue({ content: '英语面试', nextFireAt: new Date(2026, 8, 13, 9) })
    const since = new Date(NOW.getTime() - 3 * DAY_MS)

    const stats = await collectPeriodStats(USER_ID, since, NOW)

    expect(stats).toMatchObject({
      moodCounts: { happy: 2, sad: 1 }, diaryDays: 3, readingNoteCount: 2, readingBookTitle: '小王子',
      doneTaskCount: 1, doneTaskContents: ['交房租'], upcomingTask: { content: '英语面试' },
    })
    const doneInPeriod = { userId: USER_ID, status: 'done', updatedAt: { gte: since } }
    expect(mocks.taskCount).toHaveBeenCalledWith({ where: doneInPeriod })
    expect(mocks.taskFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: doneInPeriod, take: 3 }))
    expect(mocks.taskFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: USER_ID, status: 'active', instruction: null, freq: { in: ['once', 'yearly'] },
        nextFireAt: { gte: NOW, lte: new Date(NOW.getTime() + 14 * DAY_MS) },
      },
    }))
  })

  it('敏感内容（含经期）不进素材', async () => {
    mocks.memoryFindMany.mockResolvedValueOnce([{ content: '喜欢桂花味' }, { content: '月经期要喝热水' }])
    mocks.memoryCount.mockResolvedValue(2)
    mocks.messageCount.mockResolvedValue(1)

    const stats = await collectPeriodStats(USER_ID, new Date(NOW.getTime() - 3 * DAY_MS), NOW)

    expect(stats.memoryContents).toEqual(['喜欢桂花味'])
  })
})

describe('extractJsonObject / cleanLetterBody', () => {
  it('提取首个平衡对象，容忍前后杂字与字符串里的大括号', () => {
    expect(extractJsonObject('x {"letter":"a{b}c","suggestions":[]} y')).toEqual({ letter: 'a{b}c', suggestions: [] })
    expect(extractJsonObject('没有对象')).toBeNull()
    expect(extractJsonObject('{"letter": 非法}')).toBeNull()
  })

  it('敏感段整段删，超长截到最后一个段落边界', () => {
    expect(cleanLetterBody('第一段。\n\n她月经期不舒服。\n\n第三段。')).toBe('第一段。\n\n第三段。')
    const body = cleanLetterBody(`${'甲'.repeat(500)}\n\n${'乙'.repeat(500)}\n\n${'丙'.repeat(500)}`, 1200)
    expect(body).toBe(`${'甲'.repeat(500)}\n\n${'乙'.repeat(500)}`)
  })
})

describe('sanitizeSuggestions 字段校验', () => {
  const memoryById = new Map([[MEMORY.id, MEMORY]])

  it('edit_memory 建议把记忆改成 suggestText，并以服务端当前版本为准', () => {
    const [suggestion] = sanitizeSuggestions([{
      kind: 'edit_memory', title: '改一改', memoryId: 'm1', quote: '桂花味的咖啡', suggestText: '喜欢手冲',
      instruction: 'x', planDate: '2026-09-30', chatText: '按你说的改', memoryRevision: 99,
    }], memoryById)

    expect(suggestion).toMatchObject({
      kind: 'edit_memory', memoryId: 'm1', memoryRevision: 3, quote: '桂花味的咖啡',
      suggestText: '喜欢手冲', chatText: '按你说的改',
    })
  })

  it('plan 只要求 suggestText 非空；日期不合法归 null；delete_memory 的 suggestText 恒空', () => {
    const [plan] = sanitizeSuggestions([{ kind: 'plan', title: '安排一件事', suggestText: '去交稿', planDate: '2026-09-30' }], memoryById)
    expect(plan).toMatchObject({ kind: 'plan', suggestText: '去交稿', planDate: '2026-09-30', memoryId: null })

    const [badDate] = sanitizeSuggestions([{ kind: 'plan', title: '安排一件事', suggestText: '去交稿', planDate: '2026-02-30' }], memoryById)
    expect(badDate.planDate).toBeNull()

    const [removed] = sanitizeSuggestions([{ kind: 'delete_memory', title: '删掉', memoryId: 'm1', quote: '咖啡', suggestText: '不该有' }], memoryById)
    expect(removed.suggestText).toBe('')

    expect(sanitizeSuggestions([{ kind: 'plan', title: '空的', suggestText: '  ' }], memoryById)).toEqual([])
  })

  it('title/instruction/chatText 超长即丢该条，chatText 空则 null', () => {
    const [kept] = sanitizeSuggestions([{ kind: 'plan', title: '甲'.repeat(31), suggestText: '事' }], memoryById)
    expect(kept).toBeUndefined()

    const [noChat] = sanitizeSuggestions([{ kind: 'plan', title: '事', suggestText: '事', chatText: '   ' }], memoryById)
    expect(noChat.chatText).toBeNull()

    expect(sanitizeSuggestions([{ kind: 'plan', title: '事', suggestText: '事', chatText: '啊'.repeat(61) }], memoryById)).toEqual([])
    expect(sanitizeSuggestions([{ kind: 'plan', title: '事', suggestText: '事', instruction: '嗯'.repeat(201) }], memoryById)).toEqual([])
  })
})

describe('listLetters / findLatestLetter / getLetter / markLetterRead', () => {
  it('列表仅读取既有信件（新到旧），绝不隐式生成或写入', async () => {
    mocks.letterFindMany.mockResolvedValue([{ id: 'l2' }, { id: 'l1' }])

    expect((await listLetters(USER_ID)).map((letter) => letter.id)).toEqual(['l2', 'l1'])
    expect(mocks.letterCreate).not.toHaveBeenCalled()
    expect(mocks.letterFindMany).toHaveBeenCalledWith({ where: { userId: USER_ID }, orderBy: { periodStart: 'desc' } })
  })

  it('最新一封只读不生成', async () => {
    mocks.letterFindFirst.mockResolvedValue({ id: 'l1', content: '信', readAt: null })
    expect(await findLatestLetter(USER_ID)).toMatchObject({ id: 'l1' })
    expect(mocks.letterFindFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID }, orderBy: { periodStart: 'desc' }, select: { id: true, content: true, readAt: true, suggestions: true },
    })
    expect(mocks.letterCreate).not.toHaveBeenCalled()
  })

  it('读取非本人信件抛 404', async () => {
    await expect(getLetter(USER_ID, 'nope')).rejects.toMatchObject({ statusCode: 404, message: '信件不存在' })
  })

  it('读过就记下；已读再调幂等返回 success，信不存在才 404', async () => {
    mocks.letterUpdateMany.mockResolvedValue({ count: 1 })
    expect(await markLetterRead(USER_ID, 'l1', NOW)).toEqual({ success: true })
    expect(mocks.letterUpdateMany).toHaveBeenCalledWith({ where: { id: 'l1', userId: USER_ID, readAt: null }, data: { readAt: NOW } })

    mocks.letterUpdateMany.mockResolvedValue({ count: 0 })
    mocks.letterFindFirst.mockResolvedValueOnce({ id: 'l1' })
    expect(await markLetterRead(USER_ID, 'l1', NOW)).toEqual({ success: true })

    mocks.letterFindFirst.mockResolvedValueOnce(null)
    await expect(markLetterRead(USER_ID, 'nope', NOW)).rejects.toMatchObject({ statusCode: 404, message: '这封信不存在' })
  })
})
