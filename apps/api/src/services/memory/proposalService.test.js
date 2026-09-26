import { beforeEach, describe, expect, it, vi } from 'vitest'

// 事务、来源链与结束她的整理用真实逻辑（memoryGovernance / inferenceService）；写根的函数与数据库 mock 掉
const db = vi.hoisted(() => ({
  letterFindFirst: vi.fn(),
  letterUpdate: vi.fn(),
  inferenceCount: vi.fn(),
  inferenceFindFirst: vi.fn(),
  inferenceUpdateMany: vi.fn(),
  memoryFindFirst: vi.fn(),
  memoryFindMany: vi.fn(),
  messageFindFirst: vi.fn(),
}))
const memoryService = vi.hoisted(() => ({ applyMemoryChange: vi.fn(), eraseOwnedMemory: vi.fn(), createMemory: vi.fn() }))
const reminderService = vi.hoisted(() => ({ createScheduledReminder: vi.fn() }))
const embedding = vi.hoisted(() => ({ embedMemory: vi.fn() }))

vi.mock('../../prisma/client.js', () => {
  const client = {
    $queryRaw: vi.fn(() => Promise.resolve([{ id: 'user-1' }])),
    letter: { findFirst: db.letterFindFirst, update: db.letterUpdate },
    inference: { count: db.inferenceCount, findFirst: db.inferenceFindFirst, updateMany: db.inferenceUpdateMany },
    memory: { findFirst: db.memoryFindFirst, findMany: db.memoryFindMany },
    message: { findFirst: db.messageFindFirst },
  }
  client.$transaction = vi.fn((operation) => operation(client))
  return { default: client }
})
vi.mock('../memoryService.js', () => memoryService)
vi.mock('../reminderService.js', () => reminderService)
vi.mock('../embeddingService.js', () => embedding)
vi.mock('../../utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { decideSuggestion } from './proposalService.js'

const EDIT = {
  kind: 'edit_memory', title: '改一改', memoryId: 'm1', memoryRevision: 3,
  quote: '桂花味', suggestText: '喜欢桂花味的拿铁', instruction: null, planDate: null, chatText: null, decided: null,
}
const REMOVE = { ...EDIT, kind: 'delete_memory', title: '删掉', suggestText: '' }
const PLAN = {
  kind: 'plan', title: '安排复诊', memoryId: null, memoryRevision: null, quote: null,
  suggestText: '去交稿', instruction: '到点提醒她', planDate: null, chatText: null, decided: null,
}
const PAIR = [{ id: 'a', revision: 2, content: '喜欢火锅' }, { id: 'b', revision: 1, content: '爱吃火锅' }]
const MERGE = { ...EDIT, kind: 'merge_memories', title: '这两条是一回事', memoryId: null, memoryRevision: null, quote: null, suggestText: '我喜欢吃火锅', inferenceIds: ['r1'], pair: PAIR }
const CONFLICT = { ...MERGE, kind: 'resolve_conflict', title: '这两条对不上', suggestText: '', inferenceIds: ['r2'], pair: [{ id: 'a', revision: 2, content: '想独居' }, { id: 'b', revision: 1, content: '想合住' }] }
const PROMOTE = { ...EDIT, kind: 'promote_inference', title: '记下来吧', memoryId: null, memoryRevision: null, quote: '又是凌晨三点还醒着', suggestText: '我一紧张就睡不着', inferenceIds: ['i1'] }

const proposalOf = (kind, inferenceIds = []) => ({ letterId: 'l1', index: 0, kind, inferenceIds })
const withProposal = (kind, inferenceIds) => ({ action: 'accept_suggestion', proposal: proposalOf(kind, inferenceIds) })

function loadLetter(suggestions) {
  db.letterFindFirst.mockResolvedValue({ id: 'l1', userId: 'user-1', content: '见信好。', suggestions })
}

beforeEach(() => {
  vi.clearAllMocks()
  db.letterUpdate.mockImplementation(({ data }) => Promise.resolve({ id: 'l1', suggestions: data.suggestions }))
  db.inferenceCount.mockResolvedValue(1)
  db.inferenceUpdateMany.mockResolvedValue({ count: 1 })
  db.memoryFindMany.mockResolvedValue([])
  memoryService.applyMemoryChange.mockImplementation((_tx, _userId, id) => Promise.resolve({ id }))
  memoryService.eraseOwnedMemory.mockResolvedValue({ count: 1 })
  memoryService.createMemory.mockResolvedValue({ id: 'new-memory' })
})

describe('原来的三种建议：进了同一个事务，改记忆时带来源链', () => {
  it('accept × edit_memory：改成 suggestText，版本用信里那条的；这一版记下是采纳了哪条建议', async () => {
    loadLetter([EDIT])
    db.memoryFindMany.mockResolvedValue([{ id: 'm1', userId: 'user-1', content: '喜欢桂花味的拿铁', revision: 4 }])

    const result = await decideSuggestion('user-1', 'l1', '0', { decision: 'accept' })

    expect(memoryService.applyMemoryChange).toHaveBeenCalledWith(expect.anything(), 'user-1', 'm1',
      { content: '喜欢桂花味的拿铁', expectedRevision: 3 }, withProposal('edit_memory', []))
    expect(result.letter.suggestions[0].decided).toBe('accepted')
    // 事务提交之后才重算向量
    expect(embedding.embedMemory).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }))
  })

  it('accept × edit_memory：你改过的正文优先；版本冲突 409 原样透传，建议不写回', async () => {
    loadLetter([EDIT])
    memoryService.applyMemoryChange.mockRejectedValue(Object.assign(new Error('内容已经变化，请刷新后核对再保存'), { statusCode: 409, code: 'MEMORY_CONFLICT' }))

    await expect(decideSuggestion('user-1', 'l1', '0', { decision: 'accept', content: '  我改过的说法  ', expectedRevision: 2 }))
      .rejects.toMatchObject({ statusCode: 409, code: 'MEMORY_CONFLICT' })
    expect(memoryService.applyMemoryChange).toHaveBeenCalledWith(expect.anything(), 'user-1', 'm1',
      { content: '我改过的说法', expectedRevision: 2 }, expect.anything())
    expect(db.letterUpdate).not.toHaveBeenCalled()
  })

  it('accept × edit_memory：记忆已不在 → 404 这条记忆已经不在了', async () => {
    loadLetter([EDIT])
    memoryService.applyMemoryChange.mockRejectedValue(Object.assign(new Error('记忆不存在'), { statusCode: 404 }))

    await expect(decideSuggestion('user-1', 'l1', '0', { decision: 'accept' })).rejects.toMatchObject({ statusCode: 404, message: '这条记忆已经不在了' })
  })

  it('accept × delete_memory：删掉；已删过 → { success: true, already: true } 且照样置 decided', async () => {
    loadLetter([REMOVE])
    const ok = await decideSuggestion('user-1', 'l1', '0', { decision: 'accept' })
    expect(memoryService.eraseOwnedMemory).toHaveBeenCalledWith(expect.anything(), 'user-1', 'm1')
    expect(ok.letter.suggestions[0].decided).toBe('accepted')

    loadLetter([REMOVE])
    memoryService.eraseOwnedMemory.mockRejectedValue(Object.assign(new Error('记忆不存在'), { statusCode: 404 }))
    const already = await decideSuggestion('user-1', 'l1', '0', { decision: 'accept' })
    expect(already).toMatchObject({ success: true, already: true })
    expect(already.letter.suggestions[0].decided).toBe('accepted')
  })

  it('accept × plan：建一条 once 的安排（同一个事务），缺省明天（北京时间）09:00；信里写了日子就用它', async () => {
    loadLetter([PLAN])
    await decideSuggestion('user-1', 'l1', '0', { decision: 'accept' })
    expect(reminderService.createScheduledReminder).toHaveBeenCalledWith('user-1', {
      content: '去交稿', freq: 'once', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), time: '09:00', instruction: '到点提醒她',
    }, expect.anything())

    loadLetter([{ ...PLAN, planDate: '2026-10-01' }])
    await decideSuggestion('user-1', 'l1', '0', { decision: 'accept' })
    expect(reminderService.createScheduledReminder).toHaveBeenLastCalledWith('user-1', expect.objectContaining({ date: '2026-10-01' }), expect.anything())
  })

  it('dismiss：不触达记忆与安排，只置 decided: dismissed', async () => {
    loadLetter([EDIT])

    const result = await decideSuggestion('user-1', 'l1', '0', { decision: 'dismiss' })

    expect(memoryService.applyMemoryChange).not.toHaveBeenCalled()
    expect(memoryService.eraseOwnedMemory).not.toHaveBeenCalled()
    expect(reminderService.createScheduledReminder).not.toHaveBeenCalled()
    expect(db.inferenceUpdateMany).not.toHaveBeenCalled()
    expect(db.letterUpdate).toHaveBeenCalledWith({ where: { id: 'l1' }, data: { suggestions: [{ ...EDIT, decided: 'dismissed', decidedAt: expect.any(String) }] } })
    expect(result.letter.suggestions[0].decided).toBe('dismissed')
  })

  it('重复处理 409；index 越界或非整数 404；decision 非法 400；不是自己的信 404', async () => {
    loadLetter([{ ...EDIT, decided: 'accepted' }])
    await expect(decideSuggestion('user-1', 'l1', '0', { decision: 'dismiss' })).rejects.toMatchObject({ statusCode: 409, message: '这条建议已经处理过了' })

    loadLetter([EDIT])
    for (const index of ['1', 'nope', '-1']) {
      await expect(decideSuggestion('user-1', 'l1', index, { decision: 'accept' })).rejects.toMatchObject({ statusCode: 404, message: '这条建议已经不在了' })
    }
    await expect(decideSuggestion('user-1', 'l1', '0', { decision: 'maybe' })).rejects.toMatchObject({ statusCode: 400 })

    db.letterFindFirst.mockResolvedValue(null)
    await expect(decideSuggestion('user-1', 'someone-elses', '0', { decision: 'accept' })).rejects.toMatchObject({ statusCode: 404, message: '信件不存在' })
    expect(db.letterUpdate).not.toHaveBeenCalled()
  })
})

describe('从她的整理来的三种建议（路线图 C23）', () => {
  it('合并两条：先结束那条关系，再把第一条改成合并后的一句、第二条删掉（都核对版本）', async () => {
    loadLetter([MERGE])

    const result = await decideSuggestion('user-1', 'l1', '0', { decision: 'accept' })

    expect(db.inferenceUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', id: { in: ['r1'] }, status: 'active' },
      data: { status: 'closed', outcome: 'accepted', proposedIn: { letterId: 'l1', index: 0 } },
    })
    expect(memoryService.applyMemoryChange).toHaveBeenCalledWith(expect.anything(), 'user-1', 'a',
      { content: '我喜欢吃火锅', expectedRevision: 2 }, withProposal('merge_memories', ['r1']))
    expect(memoryService.eraseOwnedMemory).toHaveBeenCalledWith(expect.anything(), 'user-1', 'b', { expectedRevision: 1 })
    expect(db.inferenceUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(memoryService.applyMemoryChange.mock.invocationCallOrder[0])
    expect(result.letter.suggestions[0].decided).toBe('accepted')
  })

  it('依据的那条关系已经作废（你之后改过相关的记忆）：409，什么都不动', async () => {
    loadLetter([MERGE])
    db.inferenceCount.mockResolvedValue(0)

    await expect(decideSuggestion('user-1', 'l1', '0', { decision: 'accept' })).rejects.toMatchObject({ statusCode: 409, code: 'PROPOSAL_STALE' })
    expect(memoryService.applyMemoryChange).not.toHaveBeenCalled()
    expect(memoryService.eraseOwnedMemory).not.toHaveBeenCalled()
    expect(db.letterUpdate).not.toHaveBeenCalled()
  })

  it('定夺矛盾：留第二条就删第一条；留下的那条也核对版本', async () => {
    loadLetter([CONFLICT])
    db.memoryFindFirst.mockResolvedValue({ revision: 1 })

    await decideSuggestion('user-1', 'l1', '0', { decision: 'accept', keep: 'b' })

    expect(db.memoryFindFirst).toHaveBeenCalledWith({ where: { id: 'b', userId: 'user-1' }, select: { revision: true } })
    expect(memoryService.eraseOwnedMemory).toHaveBeenCalledWith(expect.anything(), 'user-1', 'a', { expectedRevision: 2 })
    expect(memoryService.applyMemoryChange).not.toHaveBeenCalled()
  })

  it('定夺矛盾：没说留哪条 400；要改写却没写说法 400；留下的那条已经改过 409', async () => {
    loadLetter([CONFLICT])
    await expect(decideSuggestion('user-1', 'l1', '0', { decision: 'accept' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(decideSuggestion('user-1', 'l1', '0', { decision: 'accept', keep: 'edit' })).rejects.toMatchObject({ statusCode: 400 })

    db.memoryFindFirst.mockResolvedValue({ revision: 5 })
    await expect(decideSuggestion('user-1', 'l1', '0', { decision: 'accept', keep: 'a' })).rejects.toMatchObject({ statusCode: 409 })
    expect(memoryService.eraseOwnedMemory).not.toHaveBeenCalled()
    expect(db.letterUpdate).not.toHaveBeenCalled()
  })

  it('定夺矛盾：改成一句新的——第一条改写、第二条删掉', async () => {
    loadLetter([{ ...CONFLICT, suggestText: '平时独居，周末和朋友合住' }])

    await decideSuggestion('user-1', 'l1', '0', { decision: 'accept', keep: 'edit' })

    expect(memoryService.applyMemoryChange).toHaveBeenCalledWith(expect.anything(), 'user-1', 'a',
      { content: '平时独居，周末和朋友合住', expectedRevision: 2 }, withProposal('resolve_conflict', ['r2']))
    expect(memoryService.eraseOwnedMemory).toHaveBeenCalledWith(expect.anything(), 'user-1', 'b', { expectedRevision: 1 })
  })

  it('把她猜的记下来：新建一条根（origin=promoted），来源是她当时引的原话里还站得住的', async () => {
    loadLetter([PROMOTE])
    db.inferenceFindFirst.mockResolvedValue({ basis: [
      { type: 'message', id: 'msg-1', quote: '又是凌晨三点还醒着' },
      { type: 'message', id: 'msg-gone', quote: '已经删掉的一句' },
    ] })
    db.messageFindFirst.mockImplementation(({ where }) => Promise.resolve(where.id === 'msg-1' ? { id: 'msg-1', content: '又是凌晨三点还醒着，明天还要考试' } : null))

    await decideSuggestion('user-1', 'l1', '0', { decision: 'accept' })

    expect(memoryService.createMemory).toHaveBeenCalledWith('user-1', {
      type: 'semantic', content: '我一紧张就睡不着', origin: 'promoted',
      sources: [{ type: 'message', id: 'msg-1', quote: '又是凌晨三点还醒着', status: 'verified' }],
    }, { tx: expect.anything(), action: 'accept_suggestion', proposal: proposalOf('promote_inference', ['i1']), trustedSources: true, projectEmbedding: false })
  })

  it('不用：她依据的那条整理结束为「不用」，不会再拿同一条来提；根一点不动', async () => {
    loadLetter([MERGE])

    await decideSuggestion('user-1', 'l1', '0', { decision: 'dismiss' })

    expect(db.inferenceUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', id: { in: ['r1'] }, status: 'active' },
      data: { status: 'closed', outcome: 'declined', proposedIn: { letterId: 'l1', index: 0 } },
    })
    expect(memoryService.applyMemoryChange).not.toHaveBeenCalled()
    expect(memoryService.eraseOwnedMemory).not.toHaveBeenCalled()
  })
})
