import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  followUpFindMany: vi.fn(),
  followUpFindFirst: vi.fn(),
  followUpCreateMany: vi.fn(),
  followUpUpdate: vi.fn(),
  userFindUnique: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    followUp: {
      findMany: db.followUpFindMany,
      findFirst: db.followUpFindFirst,
      createMany: db.followUpCreateMany,
      update: db.followUpUpdate,
    },
    user: { findUnique: db.userFindUnique },
  },
}))

import {
  listDueFollowUps,
  listFollowUps,
  markFollowUpAsked,
  saveFollowUps,
} from './followUpService.js'

// 北京时间 2026-09-24 星期四 上午 10 点
const THURSDAY = new Date('2026-09-24T02:00:00.000Z')
const day = (iso) => new Date(`${iso}T00:00:00.000Z`)

beforeEach(() => {
  vi.clearAllMocks()
  db.followUpFindMany.mockResolvedValue([])
  db.followUpCreateMany.mockResolvedValue({ count: 0 })
  db.userFindUnique.mockResolvedValue({ letterFreqDays: 3 })
})

describe('存下惦记的事', () => {
  it('同一天同一件事已经在惦记就不重复记（空白与大小写不算不同）', async () => {
    db.followUpFindMany.mockResolvedValue([{ about: '周三 答辩', askOn: day('2026-09-24') }])

    const result = await saveFollowUps('u1', [
      { about: '周三答辩', ask: '答辩怎么样了？', askOn: day('2026-09-24') },
      { about: '周五面试', ask: '面试顺利吗？', askOn: day('2026-09-26') },
    ])

    expect(db.followUpCreateMany).toHaveBeenCalledWith({
      data: [{ userId: 'u1', about: '周五面试', ask: '面试顺利吗？', askOn: day('2026-09-26') }],
    })
    expect(result).toEqual({ created: 1, skipped: 1 })
  })

  it('一次最多记 2 条；什么都没有就不碰数据库', async () => {
    await saveFollowUps('u1', [
      { about: 'a', ask: '?', askOn: day('2026-09-25') },
      { about: 'b', ask: '?', askOn: day('2026-09-26') },
      { about: 'c', ask: '?', askOn: day('2026-09-27') },
    ])
    expect(db.followUpCreateMany.mock.calls[0][0].data).toHaveLength(2)

    db.followUpFindMany.mockClear()
    expect(await saveFollowUps('u1', [])).toEqual({ created: 0, skipped: 0 })
    expect(db.followUpFindMany).not.toHaveBeenCalled()
  })
})

describe('什么时候问', () => {
  it('写信开着时，askOn 当天起三天内才问', async () => {
    await listDueFollowUps('u1', THURSDAY)

    expect(db.followUpFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1', status: 'active', askOn: { lte: day('2026-09-24'), gte: day('2026-09-22') } },
    }))
  })

  it('不写信时一条都不问', async () => {
    db.userFindUnique.mockResolvedValue({ letterFreqDays: null })

    expect(await listDueFollowUps('u1', THURSDAY)).toEqual([])
    expect(db.followUpFindMany).not.toHaveBeenCalled()
  })

  it('「她」页只列还在惦记的：没问过、没过期的', async () => {
    await listFollowUps('u1', THURSDAY)

    expect(db.followUpFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1', status: 'active', askOn: { gte: day('2026-09-22') } },
      orderBy: { askOn: 'asc' },
    }))
  })
})

describe('问过', () => {
  it('点了「知道了」记为问过', async () => {
    db.followUpFindFirst.mockResolvedValue({ id: 'f1', userId: 'u1' })

    await markFollowUpAsked('u1', 'f1')

    expect(db.followUpUpdate).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { status: 'asked' } })
  })
})
