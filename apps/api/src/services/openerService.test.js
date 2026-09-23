import { beforeEach, describe, expect, it, vi } from 'vitest'

const followUps = vi.hoisted(() => ({ listFollowUps: vi.fn() }))
const reading = vi.hoisted(() => ({ listBooks: vi.fn(), listRecentNotes: vi.fn() }))
const db = vi.hoisted(() => ({ userFindUnique: vi.fn(() => Promise.resolve({ letterFreqDays: 7 })) }))

vi.mock('./followUpService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  listFollowUps: followUps.listFollowUps,
}))
vi.mock('./readingService.js', () => reading)
vi.mock('../prisma/client.js', () => ({ default: { user: { findUnique: db.userFindUnique } } }))
vi.mock('../utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { MAX_OPENERS, listOpeners } from './openerService.js'

// 北京时间 2026-09-22 早上：今天 = 2026-09-22（UTC 零点存储，同惦记的事契约）
const NOW = new Date('2026-09-22T01:00:00.000Z')
const day = (iso) => new Date(`${iso}T00:00:00.000Z`)

const followUp = (overrides = {}) => ({ id: 'f1', about: '周三答辩', ask: '答辩怎么样了？', askOn: day('2026-09-22'), ...overrides })
const book = (overrides = {}) => ({ id: 'b1', title: '活着', status: 'reading', percent: 42, ...overrides })
const note = (overrides = {}) => ({ id: 'n1', content: '今天读到有庆死的那段，哭了好久\n后半句不该出现', ...overrides })

const ids = (openers) => openers.map((opener) => opener.id)

beforeEach(() => {
  vi.clearAllMocks()
  db.userFindUnique.mockResolvedValue({ letterFreqDays: 7 })
  followUps.listFollowUps.mockResolvedValue([])
  reading.listBooks.mockResolvedValue([])
  reading.listRecentNotes.mockResolvedValue([])
})

describe('开场话题从她的线索里来', () => {
  it('按优先级排：到日子的惦记 → 其它惦记 → 在读的书 → 最近的手记', async () => {
    followUps.listFollowUps.mockResolvedValue([
      followUp({ id: 'later', about: '朋友的婚礼', ask: '婚礼准备得怎么样了？', askOn: day('2026-09-24') }),
      followUp({ id: 'due', about: '周三答辩', ask: '答辩怎么样了？', askOn: day('2026-09-21') }),
    ])
    reading.listBooks.mockResolvedValue([book(), book({ id: 'b2', title: '百年孤独', status: 'want' })])
    reading.listRecentNotes.mockResolvedValue([note()])

    const openers = await listOpeners('user-1', NOW)

    expect(ids(openers)).toEqual(['followup:due', 'followup:later', 'book:b1', 'note:n1'])
    expect(openers[0]).toEqual({
      id: 'followup:due',
      label: '惦记的：周三答辩',
      text: '答辩怎么样了？',
      why: '你之前说过这件事',
    })
    expect(openers[1].why).toBe('你之前说过这件事')
    expect(openers[2]).toEqual({ id: 'book:b1', label: '《活着》', text: '我在读《活着》，想跟你聊聊这本书', why: '你正在读这本' })
    // 手记是你自己写下的私密文字：只填进输入框，正文只取第一行
    expect(openers[3]).toEqual({
      id: 'note:n1',
      label: '上次记的那句',
      text: '上次我记下的那句我还想着：今天读到有庆死的那段，哭了好久',
      draft: true,
      why: '你最近写下的一行',
    })
    expect(reading.listRecentNotes).toHaveBeenCalledWith('user-1', { limit: 1 })
    expect(followUps.listFollowUps).toHaveBeenCalledWith('user-1', NOW)
  })

  it('最多 4 条：多得出来的线索挤不进这一屏，也不重复', async () => {
    followUps.listFollowUps.mockResolvedValue([
      followUp({ id: 'f1', askOn: day('2026-09-18') }),
      followUp({ id: 'f2', askOn: day('2026-09-19') }),
      followUp({ id: 'f3', askOn: day('2026-09-20') }),
      followUp({ id: 'f4', askOn: day('2026-09-21') }),
      followUp({ id: 'f5', askOn: day('2026-09-25') }),
    ])
    reading.listBooks.mockResolvedValue([book()])
    reading.listRecentNotes.mockResolvedValue([note()])

    const openers = await listOpeners('user-1', NOW)

    expect(openers).toHaveLength(MAX_OPENERS)
    expect(ids(openers)).toEqual(['followup:f1', 'followup:f2', 'followup:f3', 'followup:f4'])
    expect(new Set(ids(openers)).size).toBe(MAX_OPENERS)
  })

  it('只有手记来源的那条带 draft', async () => {
    followUps.listFollowUps.mockResolvedValue([followUp()])
    reading.listBooks.mockResolvedValue([book()])
    reading.listRecentNotes.mockResolvedValue([note()])

    const openers = await listOpeners('user-1', NOW)

    expect(openers.filter((opener) => opener.draft === true).map((opener) => opener.id)).toEqual(['note:n1'])
    expect(openers.filter((opener) => 'draft' in opener)).toHaveLength(1)
  })

  it('某处读不到只丢这一条，其余照旧', async () => {
    followUps.listFollowUps.mockRejectedValue(new Error('database is down'))
    reading.listBooks.mockResolvedValue([book()])
    reading.listRecentNotes.mockRejectedValue(new Error('database is down'))

    await expect(listOpeners('user-1', NOW)).resolves.toEqual([
      { id: 'book:b1', label: '《活着》', text: '我在读《活着》，想跟你聊聊这本书', why: '你正在读这本' },
    ])
  })

  it('三处都空（或都读不到）就返回空数组，由前端用自己的静态池', async () => {
    await expect(listOpeners('user-1', NOW)).resolves.toEqual([])

    followUps.listFollowUps.mockRejectedValue(new Error('boom'))
    reading.listBooks.mockRejectedValue(new Error('boom'))
    reading.listRecentNotes.mockRejectedValue(new Error('boom'))
    await expect(listOpeners('user-1', NOW)).resolves.toEqual([])
  })

  it('空正文的线索不摆出来：没说的话、没写到的书名、空的手记都跳过', async () => {
    followUps.listFollowUps.mockResolvedValue([followUp({ id: 'blank', ask: '   ' })])
    reading.listBooks.mockResolvedValue([book({ title: '   ' })])
    reading.listRecentNotes.mockResolvedValue([note({ content: '\n只有第二行' })])

    await expect(listOpeners('user-1', NOW)).resolves.toEqual([])
  })

  it('同一份数据两次调用结果一致', async () => {
    followUps.listFollowUps.mockResolvedValue([followUp()])
    reading.listBooks.mockResolvedValue([book()])
    reading.listRecentNotes.mockResolvedValue([note()])

    const first = await listOpeners('user-1', NOW)
    const second = await listOpeners('user-1', NOW)

    expect(second).toEqual(first)
  })

  it('长书名与长惦记都收成短标签，方便做成一颗颗小按钮', async () => {
    followUps.listFollowUps.mockResolvedValue([followUp({ about: '下周三下午在城南医院的那场复查', ask: '复查怎么样了？' })])
    reading.listBooks.mockResolvedValue([book({ title: '卡拉马佐夫兄弟（陀思妥耶夫斯基全集第三卷）' })])

    const openers = await listOpeners('user-1', NOW)

    expect(openers[0].label).toBe('惦记的：下周三下午在城南医…')
    expect(openers[1].label).toBe('《卡拉马佐夫兄弟（陀思妥…》')
    expect(openers.every((opener) => opener.label.length <= 14)).toBe(true)
  })

  it('不写信就不再提她惦记的事：连读都不读，只留书与手记', async () => {
    db.userFindUnique.mockResolvedValue({ letterFreqDays: null })
    followUps.listFollowUps.mockResolvedValue([followUp()])
    reading.listBooks.mockResolvedValue([book()])
    reading.listRecentNotes.mockResolvedValue([note()])

    const openers = await listOpeners('user-1', NOW)

    expect(ids(openers)).toEqual(['book:b1', 'note:n1'])
    expect(followUps.listFollowUps).not.toHaveBeenCalled()
  })
})
