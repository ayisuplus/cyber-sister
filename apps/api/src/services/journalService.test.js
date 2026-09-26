import { describe, expect, it, vi } from 'vitest'

vi.mock('../prisma/client.js', () => ({ default: {} }))

import { loadJournal } from './journalService.js'

// 北京时间 2026-09-26 上午十点
const NOW = new Date('2026-09-26T02:00:00.000Z')
const at = (iso) => new Date(iso)

function fakeDb(data = {}) {
  const resolve = (value) => vi.fn(() => Promise.resolve(value))
  return {
    user: { findUnique: resolve(data.user ?? { letterFreqDays: null }) },
    inference: { findMany: resolve(data.inferences ?? []) },
    letter: { findMany: resolve(data.letters ?? []) },
    // 第一次查这几天新记下的，第二次按 id 查回想里连起来的那一对
    memory: { findMany: vi.fn(({ where }) => Promise.resolve(where.id ? (data.linked ?? []).filter((memory) => where.id.in.includes(memory.id)) : (data.memories ?? []))) },
    message: { findMany: resolve(data.messages ?? []) },
  }
}
const load = (data, options = {}) => loadJournal('u1', { now: NOW, database: fakeDb(data), ...options })
const texts = (journal) => journal.days.flatMap((day) => day.entries.map((entry) => entry.text))

describe('「她这几天」手账', () => {
  it('回想按北京时间的日子合成一句：猜了几件、连了哪一对、记下几件惦记的事', async () => {
    const reflected = { producedBy: 'reflection:2026-09-25T14:00:00.000Z', status: 'active', createdAt: at('2026-09-25T14:00:00.000Z'), updatedAt: at('2026-09-25T14:00:00.000Z') }
    const journal = await load({
      inferences: [
        { ...reflected, kind: 'insight', payload: {} },
        { ...reflected, kind: 'insight', payload: {} },
        { ...reflected, kind: 'relation', payload: { fromMemoryId: 'm1', toMemoryId: 'm2', relation: 'similar' } },
        { ...reflected, kind: 'followup', payload: { about: '周三答辩' } },
        // 导入带来的关系不是她回想出来的
        { ...reflected, producedBy: 'import', kind: 'relation', payload: { fromMemoryId: 'm1', toMemoryId: 'm3' } },
      ],
      linked: [{ id: 'm1', content: '喜欢火锅' }, { id: 'm2', content: '每周五吃火锅' }],
    })
    expect(journal.days).toEqual([{ date: '2026-09-25', entries: [
      { kind: 'reflect', at: '2026-09-25T14:00:00.000Z', text: '回想了你最近说的话，猜了 2 件事，把「喜欢火锅」和「每周五吃火锅」连在了一起，记下了 1 件她惦记的事。' },
    ] }])
  })

  it('连了不止一对就只说几对；那条记忆已经删了也不编', async () => {
    const reflected = { producedBy: 'reflection:x', status: 'active', kind: 'relation', createdAt: at('2026-09-25T14:00:00.000Z'), updatedAt: at('2026-09-25T14:00:00.000Z') }
    expect(texts(await load({ inferences: [{ ...reflected, payload: { fromMemoryId: 'm1', toMemoryId: 'm2' } }, { ...reflected, payload: { fromMemoryId: 'm2', toMemoryId: 'm3' } }] })))
      .toEqual(['回想了你最近说的话，把 2 对记忆连了起来。'])
    expect(texts(await load({ inferences: [{ ...reflected, payload: { fromMemoryId: 'gone', toMemoryId: 'm2' } }], linked: [{ id: 'm2', content: '每周五吃火锅' }] })))
      .toEqual(['回想了你最近说的话，把 1 对记忆连了起来。'])
  })

  it('你纠正过的：改了记忆后收起的、你删掉的，各合成一句；惦记的事问过你的逐条写', async () => {
    const old = at('2026-09-01T00:00:00.000Z')
    const journal = await load({ inferences: [
      { kind: 'insight', status: 'stale', producedBy: 'reflection:x', createdAt: old, updatedAt: at('2026-09-24T03:00:00.000Z') },
      { kind: 'relation', status: 'stale', producedBy: 'reflection:x', createdAt: old, updatedAt: at('2026-09-24T04:00:00.000Z') },
      { kind: 'insight', status: 'vetoed', producedBy: 'reflection:x', createdAt: old, updatedAt: at('2026-09-24T05:00:00.000Z') },
      { kind: 'followup', status: 'closed', outcome: 'asked', producedBy: 'reflection:x', payload: { about: '周三答辩' }, createdAt: old, updatedAt: at('2026-09-24T06:00:00.000Z') },
    ] })
    expect(texts(journal)).toEqual([
      '你改过记忆之后，她把靠旧说法猜的 2 件事收起来了。',
      '你说她猜错了 1 件，她记下了，不会再这样猜。',
      '记得你说过「周三答辩」，那天问了你一句。',
    ])
    expect(journal.days[0].entries.map((entry) => entry.kind)).toEqual(['tidy', 'tidy', 'ask'])
  })

  it('来信：写了一封几条建议；你采纳的逐条写做了什么，没用的合成一句；以前处理、没记时间的不写', async () => {
    const journal = await load({ letters: [
      {
        createdAt: at('2026-09-23T12:00:00.000Z'),
        suggestions: [
          { kind: 'merge_memories', decided: 'accepted', decidedAt: '2026-09-24T01:00:00.000Z' },
          { kind: 'edit_memory', decided: 'dismissed', decidedAt: '2026-09-24T01:05:00.000Z' },
          { kind: 'plan', decided: 'dismissed', decidedAt: '2026-09-24T01:06:00.000Z' },
          { kind: 'delete_memory', decided: 'accepted' },
        ],
      },
      { createdAt: at('2026-09-10T12:00:00.000Z'), suggestions: [{ kind: 'promote_inference', decided: 'accepted', decidedAt: '2026-09-25T09:00:00.000Z' }] },
    ] })
    expect(journal.days.map((day) => [day.date, day.entries.map((entry) => entry.text)])).toEqual([
      ['2026-09-25', ['你采纳了她在信里的建议，把她猜的一件事记了下来。']],
      ['2026-09-24', ['你采纳了她在信里的建议，把两条记忆合成了一条。', '信里有 2 条建议你没用，她知道了。']],
      ['2026-09-23', ['给你写了一封信，里面有 4 条建议。']],
    ])
  })

  it('记下的：「帮我记住」和你自己写的说法不同；一天太多就合成一句；导入的一句带过；采纳来的不重复写', async () => {
    const day = (hour) => at(`2026-09-24T0${hour}:00:00.000Z`)
    expect(texts(await load({ memories: [
      { content: '我对芒果过敏，吃了会起疹子', origin: 'suggestion', createdAt: day(1) },
      { content: '喜欢下雨天', origin: 'manual', createdAt: day(2) },
      { content: '她猜的，信里采纳', origin: 'promoted', createdAt: day(3) },
      { content: '导入一', origin: 'import', createdAt: day(4) },
      { content: '导入二', origin: 'import', createdAt: day(4) },
    ] }))).toEqual([
      '记住了你说的「我对芒果过敏，吃了会起疹子」。',
      '你告诉她「喜欢下雨天」，她记下了。',
      '从你带来的迁移包里记下了 2 条。',
    ])
    const many = Array.from({ length: 4 }, (_, index) => ({ content: `第${index + 1}件事，写得很长很长很长很长很长很长很长很长很长`, origin: 'manual', createdAt: day(index + 1) }))
    expect(texts(await load({ memories: many }))).toEqual(['记下了你说的 4 件事，比如「第1件事，写得很长很长很长很长很长很长很长很长很…」。'])
  })

  it('翻过的书：书名加章名，一天最多写两本', async () => {
    const note = (title, ...chapters) => ({ book: title, title, chapters: chapters.map((chapter) => ({ title: chapter })) })
    const journal = await load({ messages: [
      { createdAt: at('2026-09-24T13:00:00.000Z'), bookNotes: [note('情绪急救', '失败')] },
      { createdAt: at('2026-09-24T14:00:00.000Z'), bookNotes: [note('情绪急救', '孤独'), note('女生呵护指南', '痛经')] },
      { createdAt: at('2026-09-24T15:00:00.000Z'), bookNotes: [note('被讨厌的勇气', '课题分离')] },
    ] })
    expect(texts(journal)).toEqual(['聊天时翻了《情绪急救》「失败」「孤独」、《女生呵护指南》「痛经」等 3 本书。'])
  })

  it('只算最近 7 天（含今天，北京时间）：北京时间零点前后一秒分在两边', async () => {
    const memory = (iso) => ({ content: iso, origin: 'manual', createdAt: at(iso) })
    const journal = await load({ memories: [memory('2026-09-19T15:59:59.000Z'), memory('2026-09-19T16:00:00.000Z')] })
    expect(journal.days.map((day) => day.date)).toEqual(['2026-09-20'])
    expect(journal).toMatchObject({ windowDays: 7, lettersOn: false })
  })

  it('写信开着就标 lettersOn；翻书只查她在这个用户对话里、带了页边批注的回复', async () => {
    const database = fakeDb({ user: { letterFreqDays: 7 } })
    const journal = await loadJournal('u1', { now: NOW, database })
    expect(journal).toEqual({ windowDays: 7, lettersOn: true, days: [] })
    expect(database.message.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ role: 'assistant', conversation: { userId: 'u1' }, bookNotes: { not: expect.anything() } }),
    }))
    expect(database.memory.findMany).toHaveBeenCalledTimes(1)
  })
})
