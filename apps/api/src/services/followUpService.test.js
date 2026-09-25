import { beforeEach, describe, expect, it, vi } from 'vitest'

// 惦记的事存在她的组织层（inferences，kind=followup，路线图 C23）：用真实的 inferenceService，只 mock 数据库
const db = vi.hoisted(() => ({
  inferenceFindMany: vi.fn(),
  inferenceFindFirst: vi.fn(),
  inferenceCreateMany: vi.fn(),
  inferenceUpdateMany: vi.fn(),
  userFindUnique: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    inference: {
      findMany: db.inferenceFindMany,
      findFirst: db.inferenceFindFirst,
      createMany: db.inferenceCreateMany,
      updateMany: db.inferenceUpdateMany,
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
  db.inferenceFindMany.mockResolvedValue([])
  db.inferenceCreateMany.mockImplementation(({ data }) => Promise.resolve({ count: data.length }))
  db.inferenceUpdateMany.mockResolvedValue({ count: 1 })
  db.userFindUnique.mockResolvedValue({ letterFreqDays: 3 })
})

describe('存下惦记的事', () => {
  it('同一天同一件事已经记过就不重复（空白与大小写不算不同）；依据与过期日一起存', async () => {
    // 已有的那条的去重键：同一天 + 规范化后的那件事
    db.inferenceFindMany.mockResolvedValue([{ id: 'f0', dedupeKey: 'followup:2026-09-24:周三答辩', status: 'active' }])

    const result = await saveFollowUps('u1', [
      { about: '周三 答辩', ask: '答辩怎么样了？', askOn: day('2026-09-24') },
      { about: '周五面试', ask: '面试顺利吗？', askOn: day('2026-09-26'), basis: [{ type: 'message', id: 'msg-1', quote: '周五面试' }] },
    ])

    expect(db.inferenceCreateMany).toHaveBeenCalledWith({
      data: [{
        userId: 'u1', status: 'active', kind: 'followup', content: '面试顺利吗？',
        payload: { about: '周五面试', ask: '面试顺利吗？' },
        basis: [{ type: 'message', id: 'msg-1', quote: '周五面试' }], basisMemoryIds: [],
        dueOn: day('2026-09-26'), expiresAt: day('2026-09-29'),
        dedupeKey: 'followup:2026-09-26:周五面试', producedBy: 'reflection',
      }],
      skipDuplicates: true,
    })
    expect(result).toEqual({ created: 1, revived: 0, skipped: 1 })
  })

  it('一次最多记 2 条；什么都没有就不碰数据库', async () => {
    await saveFollowUps('u1', [
      { about: 'a', ask: '?', askOn: day('2026-09-25') },
      { about: 'b', ask: '?', askOn: day('2026-09-26') },
      { about: 'c', ask: '?', askOn: day('2026-09-27') },
    ])
    expect(db.inferenceCreateMany.mock.calls[0][0].data).toHaveLength(2)

    db.inferenceFindMany.mockClear()
    expect(await saveFollowUps('u1', [])).toEqual({ created: 0, skipped: 0 })
    expect(db.inferenceFindMany).not.toHaveBeenCalled()
  })
})

describe('什么时候问', () => {
  it('写信开着时，哪天问的当天起三天内才问；出来的样子和以前一样', async () => {
    db.inferenceFindMany.mockResolvedValue([
      { id: 'f1', content: '答辩怎么样了？', payload: { about: '周三答辩', ask: '答辩怎么样了？' }, dueOn: day('2026-09-24'), createdAt: day('2026-09-21') },
    ])

    const due = await listDueFollowUps('u1', THURSDAY)

    expect(db.inferenceFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1', kind: 'followup', status: 'active', dueOn: { lte: day('2026-09-24'), gte: day('2026-09-22') } },
    }))
    expect(due).toEqual([{ id: 'f1', about: '周三答辩', ask: '答辩怎么样了？', askOn: day('2026-09-24'), createdAt: day('2026-09-21') }])
  })

  it('不写信时一条都不问', async () => {
    db.userFindUnique.mockResolvedValue({ letterFreqDays: null })

    expect(await listDueFollowUps('u1', THURSDAY)).toEqual([])
    expect(db.inferenceFindMany).not.toHaveBeenCalled()
  })

  it('还在惦记的：没问过、没过窗口的', async () => {
    await listFollowUps('u1', THURSDAY)

    expect(db.inferenceFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1', kind: 'followup', status: 'active', dueOn: { gte: day('2026-09-22') } },
    }))
  })
})

describe('问过', () => {
  it('点了「知道了」记为问过（结束，outcome=asked）', async () => {
    await markFollowUpAsked('u1', 'f1')

    expect(db.inferenceUpdateMany).toHaveBeenCalledWith({
      where: { id: 'f1', userId: 'u1', kind: 'followup', status: 'active' },
      data: { status: 'closed', outcome: 'asked' },
    })
  })

  it('已经问过的再点一次不报错；不存在的才 404', async () => {
    db.inferenceUpdateMany.mockResolvedValue({ count: 0 })
    db.inferenceFindFirst.mockResolvedValueOnce({ id: 'f1' })
    expect(await markFollowUpAsked('u1', 'f1')).toEqual({ success: true })

    db.inferenceFindFirst.mockResolvedValueOnce(null)
    await expect(markFollowUpAsked('u1', 'nope')).rejects.toMatchObject({ statusCode: 404 })
  })
})
