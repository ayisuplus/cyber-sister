import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  findMany: vi.fn(),
  createMany: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
}))

vi.mock('../../prisma/client.js', () => ({
  default: { inference: { findMany: db.findMany, createMany: db.createMany, updateMany: db.updateMany, deleteMany: db.deleteMany } },
}))

import {
  dedupeKeyOf, deleteForMemories, listForHer, markStaleForMemory, relationContent, saveInferences, vetoInference,
} from './inferenceService.js'

const database = { inference: { findMany: db.findMany, createMany: db.createMany, updateMany: db.updateMany, deleteMany: db.deleteMany } }

beforeEach(() => {
  vi.clearAllMocks()
  db.findMany.mockResolvedValue([])
  db.createMany.mockImplementation(({ data }) => Promise.resolve({ count: data.length }))
  db.updateMany.mockResolvedValue({ count: 1 })
  db.deleteMany.mockResolvedValue({ count: 1 })
})

describe('去重键（与迁移 20260925150000_inferences 的 SQL 同一口径）', () => {
  it('关系是无向的：两端换个方向是同一条；关系种类不同就是两条', () => {
    const a = dedupeKeyOf({ kind: 'relation', payload: { fromMemoryId: 'm2', toMemoryId: 'm1', relation: 'similar' } })
    expect(a).toBe('relation:m1:m2:similar')
    expect(dedupeKeyOf({ kind: 'relation', payload: { fromMemoryId: 'm1', toMemoryId: 'm2', relation: 'similar' } })).toBe(a)
    expect(dedupeKeyOf({ kind: 'relation', payload: { fromMemoryId: 'm1', toMemoryId: 'm2', relation: 'contradicts' } })).not.toBe(a)
  })

  it('理解按内容：全角、空白与大小写都不算不同', () => {
    expect(dedupeKeyOf({ kind: 'insight', content: ' 你最近 总是很晚才睡 ' })).toBe(dedupeKeyOf({ kind: 'insight', content: '你最近总是很晚才睡' }))
    expect(dedupeKeyOf({ kind: 'insight', content: 'ＡＢＣ' })).toBe('insight:abc')
  })

  it('惦记的事按哪天问 + 那件事', () => {
    expect(dedupeKeyOf({ kind: 'followup', payload: { about: '周三 答辩' }, dueOn: new Date('2026-09-24T00:00:00.000Z') }))
      .toBe('followup:2026-09-24:周三答辩')
  })
})

describe('存下她整理的', () => {
  const insight = (content) => ({ kind: 'insight', content, payload: { category: 'pattern' }, basis: [], basisMemoryIds: ['m1', 'm1'] })

  it('新的存下（依据里的根去重），同一批里的重复只存一次', async () => {
    const result = await saveInferences('u1', [insight('你常熬夜'), insight('你常 熬夜')], { producedBy: 'reflection:t', database })

    expect(db.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: 'u1', status: 'active', content: '你常熬夜', basisMemoryIds: ['m1'], dedupeKey: 'insight:你常熬夜', producedBy: 'reflection:t' })],
      skipDuplicates: true,
    })
    expect(result).toEqual({ created: 1, revived: 0, skipped: 1 })
  })

  it('有效的、你删掉的、已经结束的都不再存；作废的按新依据复活', async () => {
    db.findMany.mockResolvedValue([
      { id: 'a', dedupeKey: 'insight:还在', status: 'active' },
      { id: 'v', dedupeKey: 'insight:你删掉的', status: 'vetoed' },
      { id: 'c', dedupeKey: 'insight:问过的', status: 'closed' },
      { id: 's', dedupeKey: 'insight:作废过的', status: 'stale' },
    ])

    const result = await saveInferences('u1', ['还在', '你删掉的', '问过的', '作废过的'].map(insight), { producedBy: 'reflection:t', database })

    expect(db.createMany).not.toHaveBeenCalled()
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: 's', userId: 'u1', status: 'stale' },
      data: expect.objectContaining({ status: 'active', content: '作废过的', outcome: null, letteredAt: null, proposedIn: null }),
    })
    expect(result).toEqual({ created: 0, revived: 1, skipped: 3 })
  })

  it('导入包里作废的关系原样作废存下，也不会去复活已有的作废条目', async () => {
    db.findMany.mockResolvedValue([{ id: 's', dedupeKey: 'relation:m1:m2:related', status: 'stale' }])
    const relation = (relationName, status) => ({
      kind: 'relation', content: relationContent('甲', '乙', relationName), status,
      payload: { fromMemoryId: 'm1', toMemoryId: 'm2', relation: relationName }, basisMemoryIds: ['m1', 'm2'],
    })

    await saveInferences('u1', [relation('related', 'stale'), relation('similar', 'stale')], { producedBy: 'import', database })

    expect(db.updateMany).not.toHaveBeenCalled()
    expect(db.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ status: 'stale', content: '「甲」与「乙」说的可能是一回事', dedupeKey: 'relation:m1:m2:similar' })],
      skipDuplicates: true,
    })
  })
})

describe('根变了，她的整理跟着变', () => {
  it('根的意思被改：以它为依据的有效条目全部作废', async () => {
    await markStaleForMemory(database, 'u1', 'm1')

    expect(db.updateMany).toHaveBeenCalledWith({ where: { userId: 'u1', status: 'active', basisMemoryIds: { has: 'm1' } }, data: { status: 'stale' } })
  })

  it('根被删：以它为依据的条目连同引文一起删（包括否决留下的去重键）', async () => {
    await deleteForMemories(database, 'u1', ['m1', 'm2'])
    expect(db.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', basisMemoryIds: { hasSome: ['m1', 'm2'] } } })

    db.deleteMany.mockClear()
    await deleteForMemories(database, 'u1', [])
    expect(db.deleteMany).not.toHaveBeenCalled()
  })
})

describe('「她猜的」', () => {
  it('只列有效、没过期的，每条带至多两句依据原话', async () => {
    db.findMany.mockResolvedValue([{
      id: 'i1', kind: 'followup', content: '答辩怎么样了？', dueOn: new Date('2026-09-24T00:00:00.000Z'), createdAt: new Date('2026-09-21T00:00:00.000Z'),
      basis: [{ quote: '周三要答辩' }, { quote: '好紧张' }, { quote: '第三句' }],
    }])

    const items = await listForHer('u1', new Date('2026-09-22T00:00:00.000Z'))

    expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'u1', status: 'active', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date('2026-09-22T00:00:00.000Z') } }] }),
    }))
    expect(items).toEqual([{ id: 'i1', kind: 'followup', content: '答辩怎么样了？', because: ['周三要答辩', '好紧张'], dueOn: '2026-09-24', createdAt: new Date('2026-09-21T00:00:00.000Z') }])
  })

  it('删掉一条就是否决：内容与依据清空、只留去重键；不是自己的或已经不在的 404', async () => {
    expect(await vetoInference('u1', 'i1')).toEqual({ success: true })
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: 'i1', userId: 'u1', status: 'active' },
      data: { status: 'vetoed', content: '', payload: {}, basis: [] },
    })

    db.updateMany.mockResolvedValue({ count: 0 })
    await expect(vetoInference('u1', 'someone-elses')).rejects.toMatchObject({ statusCode: 404 })
  })
})
