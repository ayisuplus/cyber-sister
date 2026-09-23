import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  taskFindMany: vi.fn(),
  periodFindFirst: vi.fn(),
  diaryFindFirst: vi.fn(),
  dismissalFindMany: vi.fn(),
  dismissalUpsert: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    user: { findUnique: mocks.userFindUnique },
    scheduledReminder: { findMany: mocks.taskFindMany },
    periodRecord: { findFirst: mocks.periodFindFirst },
    diaryEntry: { findFirst: mocks.diaryFindFirst },
    careDismissal: { findMany: mocks.dismissalFindMany, upsert: mocks.dismissalUpsert },
  },
}))
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { buildTouchpoints, dismissTouchpoint, listTodaysCare } from './careService.js'

// 对话末尾还会出现的那几张：今天的前 3 张里没点过「知道了」的
const listTouchpoints = async (userId) => (await listTodaysCare(userId))
  .filter((card) => !card.dismissed)
  .map(({ dismissed: _dismissed, ...card }) => card)

const USER_ID = 'user-1'
// 固定基准：本地 2026-09-09（周三）中午；todayUtc 与存储契约一致为 UTC 零点
const NOW = new Date(2026, 8, 9, 12, 0, 0)
const TODAY_UTC = new Date('2026-09-09T00:00:00.000Z')
const utcDay = (dayStr) => new Date(`${dayStr}T00:00:00.000Z`)
// 安排的 nextFireAt 是绝对时刻：2026 年 9 月 day 日本地 hour:minute
const at = (day, hour, minute = 0) => new Date(2026, 8, day, hour, minute)

const EMPTY_SNAPSHOT = {
  user: {},
  tasks: [],
  latestPeriod: null,
  yesterdayDiary: null,
  todayUtc: TODAY_UTC,
  now: NOW,
}

const build = (overrides) => buildTouchpoints({ ...EMPTY_SNAPSHOT, ...overrides })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.userFindUnique.mockResolvedValue({ birthDate: null, careEnabled: true })
  mocks.taskFindMany.mockResolvedValue([])
  mocks.periodFindFirst.mockResolvedValue(null)
  mocks.diaryFindFirst.mockResolvedValue(null)
  mocks.dismissalFindMany.mockResolvedValue([])
  mocks.dismissalUpsert.mockResolvedValue({})
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

  it('过了预计的日子还没记：晚 1 到 7 天说一句，不悄悄消失，也不天天追着问', () => {
    // 预计 9 月 8 日，今天 9 月 9 日：晚 1 天
    const late1 = build({ latestPeriod: { id: 'p1', startDate: utcDay('2026-08-11'), cycleDays: 28 } })
    expect(late1[0]).toMatchObject({ kind: 'period-late', key: 'period-late:p1:2026-09-09', title: '比预计晚了 1 天' })
    expect(late1[0].body).toContain('晚几天很常见')
    expect(late1[0].reason).toContain('还没有新的记录')
    // 预计 9 月 2 日：晚 7 天；预计 9 月 1 日：晚 8 天，不再说
    expect(build({ latestPeriod: { id: 'p1', startDate: utcDay('2026-08-05'), cycleDays: 28 } })[0].title).toBe('比预计晚了 7 天')
    expect(build({ latestPeriod: { id: 'p1', startDate: utcDay('2026-08-04'), cycleDays: 28 } })).toEqual([])
  })

  it('用她当前的说话方式写；不认识的说话方式按温柔', () => {
    const mood = (persona) => build({ user: { persona }, yesterdayDiary: { mood: 'sad' } })[0].body
    const bodies = ['gentle', 'toxic', 'cool'].map(mood)
    expect(new Set(bodies).size).toBe(3)
    expect(mood('toxic')).toContain('谁惹你了')
    expect(mood('rational')).toBe(mood('gentle'))
    const late = (persona) => build({ user: { persona }, latestPeriod: { id: 'p1', startDate: utcDay('2026-08-11'), cycleDays: 28 } })[0].body
    expect(new Set(['gentle', 'toxic', 'cool'].map(late)).size).toBe(3)
  })

  it('今天的安排聚成一条，只有一件时直呼其名', () => {
    const one = build({ tasks: [{ id: 't1', content: '复诊', nextFireAt: at(9, 15) }] })
    expect(one).toHaveLength(1)
    expect(one[0]).toMatchObject({ kind: 'task-today', key: 'task-today:all:2026-09-09', title: '今天：「复诊」' })
    expect(one[0].action).toEqual({ to: '/tools/calendar', label: '看看日历' })

    const two = build({ tasks: [
      { id: 't1', content: '复诊', nextFireAt: at(9, 8) },
      { id: 't2', content: '还书', nextFireAt: at(9, 20) },
    ] })
    expect(two[0]).toMatchObject({ kind: 'task-today', title: '今天有 2 件事' })
    expect(two[0].body).toContain('复诊')
  })

  it('心情卡片跳到手记里的日记', () => {
    expect(build({ yesterdayDiary: { mood: 'sad' } })[0].action).toEqual({ to: '/tools/notes?tab=diary', label: '写写今天' })
  })

  it('1~3 天内的安排各一条「还有 N 天」，按天数排序，4 天与已过去的不触发', () => {
    const cards = build({
      tasks: [
        { id: 't1', content: '面试', nextFireAt: at(10, 9) },
        { id: 't3', content: '出成绩', nextFireAt: at(11, 23, 30) },
        { id: 't2', content: '旅行', nextFireAt: at(12, 7) },
        { id: 't4', content: '考研', nextFireAt: at(13, 9) },
        { id: 't0', content: '昨天的事', nextFireAt: at(8, 9) },
      ],
    })
    expect(cards.map((card) => card.title)).toEqual(['「面试」还有 1 天', '「出成绩」还有 2 天', '「旅行」还有 3 天'])
    expect(cards[0]).toMatchObject({ kind: 'task-soon', key: 'task-soon:t1:2026-09-09' })
  })

  it('昨天心情沉重触发，开心与中性不触发', () => {
    for (const mood of ['sad', 'angry', 'anxious']) {
      expect(build({ yesterdayDiary: { mood } })[0]).toMatchObject({ kind: 'mood', title: '昨天你好像不太好' })
    }
    expect(build({ yesterdayDiary: { mood: 'happy' } })).toEqual([])
    expect(build({ yesterdayDiary: { mood: 'neutral' } })).toEqual([])
  })

  it('综合优先级：生日 > 经期 > 今天的安排 > 快到的日子 > 心情', () => {
    const cards = build({
      user: { birthDate: new Date('1999-09-09T00:00:00.000Z') },
      latestPeriod: { id: 'p1', startDate: utcDay('2026-08-12'), cycleDays: 28 },
      tasks: [
        { id: 't1', content: '还书', nextFireAt: at(9, 18) },
        { id: 't2', content: '面试', nextFireAt: at(11, 9) },
      ],
      yesterdayDiary: { mood: 'sad' },
    })
    expect(cards.map((card) => card.kind)).toEqual(['birthday', 'period', 'task-today', 'task-soon', 'mood'])
  })
})

describe('listTodaysCare', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    return () => vi.useRealTimers()
  })

  it('撤回经期记录同意后不再读经期，也就没有经期卡片', async () => {
    mocks.periodFindFirst.mockResolvedValue({ id: 'p1', startDate: utcDay('2026-08-12'), cycleDays: 28 })
    mocks.userFindUnique.mockResolvedValue({ birthDate: null, careEnabled: true, periodConsentAt: null })
    expect(await listTouchpoints(USER_ID)).toEqual([])
    expect(mocks.periodFindFirst).not.toHaveBeenCalled()

    mocks.userFindUnique.mockResolvedValue({ birthDate: null, careEnabled: true, periodConsentAt: new Date('2026-09-01T00:00:00.000Z') })
    expect((await listTouchpoints(USER_ID)).map((card) => card.kind)).toEqual(['period'])
  })

  it('点掉一张不会让第 4 张补上来：一天至多三张', async () => {
    mocks.taskFindMany.mockResolvedValue([
      { id: 't1', content: '甲', nextFireAt: at(9, 18) },
      { id: 't2', content: '乙', nextFireAt: at(10, 9) },
      { id: 't3', content: '丙', nextFireAt: at(11, 9) },
      { id: 't4', content: '丁', nextFireAt: at(12, 9) },
    ])
    const [first] = await listTouchpoints(USER_ID)
    mocks.dismissalFindMany.mockResolvedValue([{ key: first.key }])
    const rest = await listTouchpoints(USER_ID)
    expect(rest).toHaveLength(2)
    expect(rest.map((card) => card.title)).not.toContain('「丁」还有 3 天')
  })

  it('总开关关闭时为空，且不再查询任何数据', async () => {
    mocks.userFindUnique.mockResolvedValue({ birthDate: null, careEnabled: false })

    expect(await listTouchpoints(USER_ID)).toEqual([])
    expect(mocks.taskFindMany).not.toHaveBeenCalled()
  })

  it('只查进行中、带日子、无指令的安排，窗口为本地今天起 4 个日历日', async () => {
    await listTouchpoints(USER_ID)
    expect(mocks.taskFindMany).toHaveBeenCalledWith({
      where: {
        userId: USER_ID, status: 'active', instruction: null, freq: { in: ['once', 'yearly'] },
        nextFireAt: { gte: new Date(2026, 8, 9), lt: new Date(2026, 8, 13) },
      },
      orderBy: { nextFireAt: 'asc' },
      select: { id: true, content: true, nextFireAt: true },
    })
  })

  it('用户不存在时为空', async () => {
    mocks.userFindUnique.mockResolvedValue(null)
    expect(await listTouchpoints(USER_ID)).toEqual([])
  })

  it('已忽略的键被过滤，结果剥离 priority', async () => {
    mocks.taskFindMany.mockResolvedValue([{ id: 't1', content: '面试', nextFireAt: at(10, 9) }])
    const [card] = await listTouchpoints(USER_ID)
    expect(card.key).toBeDefined()
    expect(card.priority).toBeUndefined()

    mocks.dismissalFindMany.mockResolvedValue([{ key: card.key }])
    expect(await listTouchpoints(USER_ID)).toEqual([])
    // 点过的仍算她今天说过，只是标上 dismissed
    expect(await listTodaysCare(USER_ID)).toEqual([{ ...card, dismissed: true }])
  })

  it('最多返回 3 条按优先级截取', async () => {
    mocks.taskFindMany.mockResolvedValue([
      { id: 't1', content: '甲', nextFireAt: at(9, 18) },
      { id: 't2', content: '乙', nextFireAt: at(10, 9) },
      { id: 't3', content: '丙', nextFireAt: at(11, 9) },
      { id: 't4', content: '丁', nextFireAt: at(12, 9) },
    ])
    mocks.diaryFindFirst.mockResolvedValue({ mood: 'sad' })

    const cards = await listTouchpoints(USER_ID)
    expect(cards).toHaveLength(3)
    expect(cards.map((card) => card.kind)).toEqual(['task-today', 'task-soon', 'task-soon'])
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
    expect(await dismissTouchpoint(USER_ID, ' task-soon:t1:2026-09-09 ')).toEqual({ dismissed: true })
    expect(mocks.dismissalUpsert).toHaveBeenCalledWith({
      where: { userId_key: { userId: USER_ID, key: 'task-soon:t1:2026-09-09' } },
      create: { userId: USER_ID, key: 'task-soon:t1:2026-09-09' },
      update: {},
    })
  })
})
