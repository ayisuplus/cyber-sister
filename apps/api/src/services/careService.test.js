import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  todoFindMany: vi.fn(),
  countdownFindMany: vi.fn(),
  periodFindFirst: vi.fn(),
  diaryFindFirst: vi.fn(),
  dismissalFindMany: vi.fn(),
  dismissalUpsert: vi.fn(),
  listHabitsWithStatus: vi.fn(),
  getStudySummary: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    user: { findUnique: mocks.userFindUnique },
    todo: { findMany: mocks.todoFindMany },
    countdown: { findMany: mocks.countdownFindMany },
    periodRecord: { findFirst: mocks.periodFindFirst },
    diaryEntry: { findFirst: mocks.diaryFindFirst },
    careDismissal: { findMany: mocks.dismissalFindMany, upsert: mocks.dismissalUpsert },
  },
}))
vi.mock('./habitService.js', () => ({ listHabitsWithStatus: mocks.listHabitsWithStatus }))
vi.mock('./studyService.js', () => ({ getSummary: mocks.getStudySummary }))
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { buildTouchpoints, dismissTouchpoint, listTouchpoints } from './careService.js'

const USER_ID = 'user-1'
// 固定基准：本地 2026-09-09（周三）中午；todayUtc 与存储契约一致为 UTC 零点
const NOW = new Date(2026, 8, 9, 12, 0, 0)
const TODAY_UTC = new Date('2026-09-09T00:00:00.000Z')
const utcDay = (dayStr) => new Date(`${dayStr}T00:00:00.000Z`)

const EMPTY_SNAPSHOT = {
  user: {},
  todos: [],
  countdowns: [],
  latestPeriod: null,
  habits: [],
  study: { streak: 0, todayMinutes: 0 },
  yesterdayDiary: null,
  todayUtc: TODAY_UTC,
  now: NOW,
}

const build = (overrides) => buildTouchpoints({ ...EMPTY_SNAPSHOT, ...overrides })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.userFindUnique.mockResolvedValue({ birthDate: null, careEnabled: true })
  mocks.todoFindMany.mockResolvedValue([])
  mocks.countdownFindMany.mockResolvedValue([])
  mocks.periodFindFirst.mockResolvedValue(null)
  mocks.diaryFindFirst.mockResolvedValue(null)
  mocks.dismissalFindMany.mockResolvedValue([])
  mocks.dismissalUpsert.mockResolvedValue({})
  mocks.listHabitsWithStatus.mockResolvedValue([])
  mocks.getStudySummary.mockResolvedValue({ streak: 0, todayMinutes: 0, weekMinutes: 0, totalSessions: 0 })
})

describe('buildTouchpoints 规则引擎', () => {
  it('无数据时零触点', () => {
    expect(build({})).toEqual([])
  })

  it('生日今天/明天触发，键稳定', () => {
    const today = build({ user: { birthDate: new Date('1999-09-09T00:00:00.000Z') } })
    expect(today).toHaveLength(1)
    expect(today[0]).toMatchObject({ kind: 'birthday', key: 'birthday:profile:2026-09-09', title: '今天是你生日' })

    const tomorrow = build({ user: { birthDate: new Date('1999-09-10T00:00:00.000Z') } })
    expect(tomorrow[0].title).toBe('明天是你生日')

    expect(build({ user: { birthDate: new Date('1999-12-01T00:00:00.000Z') } })).toEqual([])
  })

  it('经期预测 0~3 天触发，4 天与已过期不触发', () => {
    const in2Days = build({ latestPeriod: { id: 'p1', startDate: utcDay('2026-08-16'), cycleDays: 26 } })
    expect(in2Days[0]).toMatchObject({ kind: 'period', title: '预计 2 天后来大姨妈' })
    expect(in2Days[0].reason).toContain('8月16日')

    const today = build({ latestPeriod: { id: 'p1', startDate: utcDay('2026-08-12'), cycleDays: 28 } })
    expect(today[0].title).toBe('大姨妈可能今天到')

    const in4Days = build({ latestPeriod: { id: 'p1', startDate: utcDay('2026-08-13'), cycleDays: 32 } })
    expect(in4Days).toEqual([])

    const overdue = build({ latestPeriod: { id: 'p1', startDate: utcDay('2026-08-01'), cycleDays: 28 } })
    expect(overdue).toEqual([])
  })

  it('倒数日 0~3 天触发并按天数排序', () => {
    const cards = build({
      countdowns: [
        { id: 'c3', title: '出成绩', targetDate: utcDay('2026-09-11') },
        { id: 'c1', title: '面试', targetDate: utcDay('2026-09-09') },
        { id: 'c2', title: '旅行', targetDate: utcDay('2026-09-12') },
        { id: 'c4', title: '考研', targetDate: utcDay('2026-12-20') },
      ],
    })
    expect(cards.map((card) => card.title)).toEqual(['就是今天：「面试」', '「出成绩」还有 2 天', '「旅行」还有 3 天'])
  })

  it('逾期日程取最久一条，今天到期聚合计数', () => {
    const cards = build({
      todos: [
        { id: 't2', content: '交房租', dueDate: utcDay('2026-09-05') },
        { id: 't1', content: '复诊', dueDate: utcDay('2026-09-01') },
        { id: 't3', content: '还书', dueDate: utcDay('2026-09-09') },
      ],
    })
    expect(cards.map((card) => card.kind)).toEqual(['todo-overdue', 'todo-today'])
    expect(cards[0]).toMatchObject({ key: 'todo-overdue:t1:2026-09-09', title: '有件事拖了 8 天' })
    expect(cards[0].body).toContain('复诊')
    expect(cards[1]).toMatchObject({ title: '今天有 1 件事到期' })
    expect(cards[1].body).toContain('还书')
  })

  it('手帐连续 3 天且今天未打卡触发，已打卡或连续不足不触发', () => {
    const risk = build({ habits: [{ id: 'h1', name: '喝水', streak: 12, checkedToday: false }] })
    expect(risk[0]).toMatchObject({ kind: 'habit', title: '「喝水」今天还没打卡' })
    expect(risk[0].body).toContain('12 天')

    expect(build({ habits: [{ id: 'h1', name: '喝水', streak: 12, checkedToday: true }] })).toEqual([])
    expect(build({ habits: [{ id: 'h1', name: '喝水', streak: 2, checkedToday: false }] })).toEqual([])
  })

  it('自习连续 3 天且今天 0 分钟触发', () => {
    const risk = build({ study: { streak: 5, todayMinutes: 0 } })
    expect(risk[0]).toMatchObject({ kind: 'study', title: '自习今天还没开始' })

    expect(build({ study: { streak: 5, todayMinutes: 25 } })).toEqual([])
    expect(build({ study: { streak: 2, todayMinutes: 0 } })).toEqual([])
  })

  it('昨天心情沉重触发，开心与中性不触发', () => {
    for (const mood of ['sad', 'angry', 'anxious']) {
      expect(build({ yesterdayDiary: { mood } })[0]).toMatchObject({ kind: 'mood', title: '昨天你好像不太好' })
    }
    expect(build({ yesterdayDiary: { mood: 'happy' } })).toEqual([])
    expect(build({ yesterdayDiary: { mood: 'neutral' } })).toEqual([])
  })

  it('综合优先级：生日 > 经期 > 倒数日 > 逾期 > 今日到期 > 手帐 > 自习 > 心情', () => {
    const cards = build({
      user: { birthDate: new Date('1999-09-09T00:00:00.000Z') },
      latestPeriod: { id: 'p1', startDate: utcDay('2026-08-12'), cycleDays: 28 },
      countdowns: [{ id: 'c1', title: '面试', targetDate: utcDay('2026-09-09') }],
      todos: [
        { id: 't1', content: '复诊', dueDate: utcDay('2026-09-01') },
        { id: 't2', content: '还书', dueDate: utcDay('2026-09-09') },
      ],
      habits: [{ id: 'h1', name: '喝水', streak: 12, checkedToday: false }],
      study: { streak: 5, todayMinutes: 0 },
      yesterdayDiary: { mood: 'sad' },
    })
    expect(cards.map((card) => card.kind)).toEqual([
      'birthday', 'period', 'countdown', 'todo-overdue', 'todo-today', 'habit', 'study', 'mood',
    ])
  })
})

describe('listTouchpoints', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    return () => vi.useRealTimers()
  })

  it('总开关关闭时为空，且不再查询任何数据', async () => {
    mocks.userFindUnique.mockResolvedValue({ birthDate: null, careEnabled: false })

    expect(await listTouchpoints(USER_ID)).toEqual([])
    expect(mocks.todoFindMany).not.toHaveBeenCalled()
    expect(mocks.countdownFindMany).not.toHaveBeenCalled()
  })

  it('用户不存在时为空', async () => {
    mocks.userFindUnique.mockResolvedValue(null)
    expect(await listTouchpoints(USER_ID)).toEqual([])
  })

  it('已忽略的键被过滤，结果剥离 priority', async () => {
    mocks.countdownFindMany.mockResolvedValue([{ id: 'c1', title: '面试', targetDate: utcDay('2026-09-10') }])
    const [card] = await listTouchpoints(USER_ID)
    expect(card.key).toBeDefined()
    expect(card.priority).toBeUndefined()

    mocks.dismissalFindMany.mockResolvedValue([{ key: card.key }])
    expect(await listTouchpoints(USER_ID)).toEqual([])
  })

  it('最多返回 3 条按优先级截取', async () => {
    mocks.countdownFindMany.mockResolvedValue([
      { id: 'c1', title: '甲', targetDate: utcDay('2026-09-09') },
      { id: 'c2', title: '乙', targetDate: utcDay('2026-09-10') },
      { id: 'c3', title: '丙', targetDate: utcDay('2026-09-11') },
      { id: 'c4', title: '丁', targetDate: utcDay('2026-09-12') },
    ])
    mocks.todoFindMany.mockResolvedValue([{ id: 't1', content: '复诊', dueDate: utcDay('2026-09-01') }])

    const cards = await listTouchpoints(USER_ID)
    expect(cards).toHaveLength(3)
    expect(cards.map((card) => card.kind)).toEqual(['countdown', 'countdown', 'countdown'])
  })
})

describe('dismissTouchpoint', () => {
  it('非法键抛 400', async () => {
    await expect(dismissTouchpoint(USER_ID, '')).rejects.toMatchObject({ statusCode: 400, message: '触点键不合法' })
    await expect(dismissTouchpoint(USER_ID, null)).rejects.toMatchObject({ statusCode: 400 })
    await expect(dismissTouchpoint(USER_ID, 'x'.repeat(201))).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.dismissalUpsert).not.toHaveBeenCalled()
  })

  it('合法键按 用户+键 幂等 upsert', async () => {
    expect(await dismissTouchpoint(USER_ID, ' countdown:c1:2026-09-09 ')).toEqual({ dismissed: true })
    expect(mocks.dismissalUpsert).toHaveBeenCalledWith({
      where: { userId_key: { userId: USER_ID, key: 'countdown:c1:2026-09-09' } },
      create: { userId: USER_ID, key: 'countdown:c1:2026-09-09' },
      update: {},
    })
  })
})
