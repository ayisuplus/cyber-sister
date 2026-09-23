import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  memoryFindMany: vi.fn(),
  memoryCount: vi.fn(),
  memoryCreate: vi.fn(),
  memoryFindFirst: vi.fn(),
  memoryUpdate: vi.fn(),
  memoryDelete: vi.fn(),
  memoryDeleteMany: vi.fn(),
  diaryEntryFindFirst: vi.fn(),
  readingNoteFindFirst: vi.fn(),
  scheduledReminderFindFirst: vi.fn(),
  collectionItemFindFirst: vi.fn(),
}))

const embedding = vi.hoisted(() => ({ embedMemory: vi.fn() }))

vi.mock('../prisma/client.js', () => {
  const client = {
    $queryRaw: vi.fn(async () => [{ id: 'u1' }]),
    user: { update: vi.fn() },
    memoryRevision: { create: vi.fn(), findMany: vi.fn(async () => []) },
    memoryProjection: { updateMany: vi.fn(), deleteMany: vi.fn() },
    memoryEdge: { updateMany: vi.fn() },
    memoryIndexJob: { updateMany: vi.fn() },
    derivedInsight: { updateMany: vi.fn(), deleteMany: vi.fn() },
    diaryEntry: { findFirst: db.diaryEntryFindFirst },
    readingNote: { findFirst: db.readingNoteFindFirst },
    scheduledReminder: { findFirst: db.scheduledReminderFindFirst },
    collectionItem: { findFirst: db.collectionItemFindFirst },
    memory: {
      findMany: db.memoryFindMany,
      count: db.memoryCount,
      create: db.memoryCreate,
      findFirst: db.memoryFindFirst,
      update: db.memoryUpdate,
      delete: db.memoryDelete,
      deleteMany: db.memoryDeleteMany,
    },
  }
  client.$transaction = vi.fn((operation) => operation(client))
  return { default: client }
})

vi.mock('./embeddingService.js', () => embedding)

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  createMemory,
  deleteMemory,
  listMemories,
  setMemoryPinned,
  updateMemory,
} from './memoryService.js'

beforeEach(() => {
  vi.clearAllMocks()
  db.memoryFindMany.mockResolvedValue([])
})

describe('createMemory', () => {
  it('工作台确认真实记忆时可显式关闭嵌入，保留数据保存', async () => {
    db.memoryCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'm1', ...data, entities: null }))
    const memory = await createMemory('u1', { type: 'semantic', content: '用户确认的事实', origin: 'promoted' }, { projectEmbedding: false })
    expect(memory.content).toBe('用户确认的事实')
    expect(db.memoryCreate).toHaveBeenCalled()
    expect(embedding.embedMemory).not.toHaveBeenCalled()
  })
  it('创建记忆并解析 JSON 字段返回', async () => {
    db.memoryCreate.mockImplementation(({ data }) => Promise.resolve({
      id: 'm1',
      ...data,
      entities: null,
    }))
    const memory = await createMemory('u1', {
      type: 'semantic',
      content: '  喜欢火锅  ',
      tags: ['美食', ' 美食 ', '火锅'],
    })
    expect(db.memoryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        content: '喜欢火锅',
        importance: 5,
        // 去空白后去重
        tags: JSON.stringify(['美食', '火锅']),
      }),
    })
    expect(memory.tags).toEqual(['美食', '火锅'])
    expect(memory.entities).toEqual({})
  })

  it('创建后 fire-and-forget 触发语义投影，失败不影响保存结果', async () => {
    db.memoryCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'm1', ...data, entities: null }))

    const memory = await createMemory('u1', { type: 'semantic', content: '喜欢火锅' })

    expect(embedding.embedMemory).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1', content: '喜欢火锅' }))
    expect(memory.content).toBe('喜欢火锅')
  })

  it('响应剥离 embedding/embeddingModel 机器投影字段', async () => {
    db.memoryCreate.mockImplementation(({ data }) => Promise.resolve({
      id: 'm1', ...data, entities: null, embedding: [0.1, 0.2], embeddingModel: 'text-embedding-v4',
    }))

    const memory = await createMemory('u1', { type: 'semantic', content: '喜欢火锅' })

    expect(memory).not.toHaveProperty('embedding')
    expect(memory).not.toHaveProperty('embeddingModel')
  })

  it('origin/sourceRef 落库并随返回带出；默认 origin 为 manual', async () => {
    db.memoryCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'm1', ...data, entities: null }))
    const memory = await createMemory('u1', {
      type: 'semantic',
      content: '她想要独立书房',
      origin: 'promoted',
      sourceRef: ' insight-1 ',
    })
    expect(db.memoryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ origin: 'promoted', sourceRef: 'insight-1' }),
    })
    expect(memory.origin).toBe('promoted')
    expect(memory.sourceRef).toBe('insight-1')

    await createMemory('u1', { type: 'semantic', content: '手动记忆' })
    expect(db.memoryCreate).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ origin: 'manual', sourceRef: null }),
    })
  })

  it('非法 origin 与非法 sourceRef 抛 400', async () => {
    await expect(createMemory('u1', { type: 'semantic', content: 'x', origin: 'wild' }))
      .rejects.toMatchObject({ statusCode: 400, message: '记忆来源不合法' })
    await expect(createMemory('u1', { type: 'semantic', content: 'x', sourceRef: 42 }))
      .rejects.toMatchObject({ statusCode: 400, message: '来源引用不合法' })
    await expect(createMemory('u1', { type: 'semantic', content: 'x', sourceRef: '  ' }))
      .rejects.toMatchObject({ statusCode: 400, message: '来源引用不合法' })
    await expect(createMemory('u1', { type: 'semantic', content: 'x', sourceRef: 'y'.repeat(65) }))
      .rejects.toMatchObject({ statusCode: 400, message: '来源引用不合法' })
    expect(db.memoryCreate).not.toHaveBeenCalled()
  })

  it('拒绝非法类型、空内容、超长内容与非法重要度', async () => {
    await expect(createMemory('u1', { type: 'wild', content: 'x' })).rejects.toMatchObject({
      statusCode: 400,
    })
    await expect(createMemory('u1', { type: 'semantic', content: '   ' })).rejects.toMatchObject({
      message: '记忆内容不能为空',
    })
    await expect(createMemory('u1', { type: 'semantic', content: 'x'.repeat(2001) }))
      .rejects.toMatchObject({ message: '记忆内容不能超过2000个字符' })
    await expect(createMemory('u1', { type: 'semantic', content: 'x', importance: 0 }))
      .rejects.toMatchObject({ message: '重要程度必须是1到10之间的整数' })
    await expect(createMemory('u1', { type: 'semantic', content: 'x', importance: 5.5 }))
      .rejects.toMatchObject({ statusCode: 400 })
    expect(db.memoryCreate).not.toHaveBeenCalled()
  })

  it('标签必须是最多 10 项的短字符串数组', async () => {
    await expect(createMemory('u1', { type: 'semantic', content: 'x', tags: 'not-array' }))
      .rejects.toMatchObject({ message: '标签必须是最多10项的数组' })
    await expect(createMemory('u1', {
      type: 'semantic',
      content: 'x',
      tags: Array.from({ length: 11 }, (_, i) => `t${i}`),
    })).rejects.toMatchObject({ statusCode: 400 })
    await expect(createMemory('u1', { type: 'semantic', content: 'x', tags: [''] }))
      .rejects.toMatchObject({ message: '每个标签必须为1到30个字符' })
    await expect(createMemory('u1', { type: 'semantic', content: 'x', tags: ['y'.repeat(31)] }))
      .rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('createMemory：手记/读书/日历/收藏四类痕迹来源', () => {
  const DIARY = { id: 'd1', content: '今天在工作室待到很晚，把展览方案定了下来' }
  const NOTE = { id: 'n1', quote: '人是为活着本身而活着的', content: '这句看得我心里一震' }

  it('本人手记的原文片段核验通过，落库为 verified', async () => {
    db.diaryEntryFindFirst.mockResolvedValue(DIARY)
    db.memoryCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'm1', ...data, entities: null }))

    await createMemory('u1', {
      type: 'semantic',
      content: '她最近在准备展览方案',
      sources: [{ type: 'diary', id: 'd1', quote: '把展览方案定了下来' }],
    })

    expect(db.diaryEntryFindFirst).toHaveBeenCalledWith({ where: { id: 'd1', userId: 'u1' } })
    expect(db.memoryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sources: [{ type: 'diary', id: 'd1', quote: '把展览方案定了下来', status: 'verified' }],
      }),
    })
  })

  it('引用片段不是来源原文的子串抛 409 引用片段与来源不一致', async () => {
    db.diaryEntryFindFirst.mockResolvedValue(DIARY)

    await expect(createMemory('u1', {
      type: 'semantic', content: 'x', sources: [{ type: 'diary', id: 'd1', quote: '凭空改写的一句' }],
    })).rejects.toMatchObject({ statusCode: 409, message: '引用片段与来源不一致' })
    expect(db.memoryCreate).not.toHaveBeenCalled()
  })

  it('他人或已删的痕迹抛 409 来源已不可用', async () => {
    db.diaryEntryFindFirst.mockResolvedValue(null)

    await expect(createMemory('u1', {
      type: 'semantic', content: 'x', sources: [{ type: 'diary', id: 'other-diary', quote: 'x' }],
    })).rejects.toMatchObject({ statusCode: 409, message: '来源已不可用，请重新核对内容' })
    expect(db.memoryCreate).not.toHaveBeenCalled()
  })

  it('读书笔记可用 quote 字段里的原文子串通过', async () => {
    db.readingNoteFindFirst.mockResolvedValue(NOTE)
    db.memoryCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'm1', ...data, entities: null }))

    await createMemory('u1', {
      type: 'semantic',
      content: '《活着》里那句她记住了',
      sources: [{ type: 'reading_note', id: 'n1', quote: '为活着本身而活着' }],
    })

    expect(db.memoryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sources: [{ type: 'reading_note', id: 'n1', quote: '为活着本身而活着', status: 'verified' }],
      }),
    })
  })
})

describe('listMemories', () => {
  it('非法分页参数回退默认，limit 封顶 100', async () => {
    db.memoryFindMany.mockResolvedValue([])
    db.memoryCount.mockResolvedValue(0)

    const result = await listMemories('u1', { page: -3, limit: 9999 })
    expect(result).toMatchObject({ page: 1, limit: 100, total: 0, data: [] })
    expect(db.memoryFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 100 }))

    await listMemories('u1', {})
    expect(db.memoryFindMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 0, take: 20 }))
  })

  it('类型过滤参与查询且非法类型报错', async () => {
    db.memoryFindMany.mockResolvedValue([])
    db.memoryCount.mockResolvedValue(0)

    await listMemories('u1', { type: 'episodic' })
    expect(db.memoryFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1', type: 'episodic' },
    }))

    // 空字符串类型视为不过滤
    await listMemories('u1', { type: '' })
    expect(db.memoryFindMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { userId: 'u1' },
    }))

    await expect(listMemories('u1', { type: 'wild' })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('损坏的 JSON 字段回退为空对象与空数组', async () => {
    db.memoryFindMany.mockResolvedValue([
      { id: 'm1', entities: '{broken', tags: '[oops' },
    ])
    db.memoryCount.mockResolvedValue(1)
    const result = await listMemories('u1', {})
    expect(result.data[0].entities).toEqual({})
    expect(result.data[0].tags).toEqual([])
  })
})

describe('updateMemory', () => {
  it('提案后记忆已被编辑时拒绝旧版本，不覆盖新内容', async () => {
    db.memoryFindFirst.mockResolvedValue({ id: 'm1', userId: 'u1', revision: 2, content: '用户后来改的内容' })
    await expect(updateMemory('u1', 'm1', { content: '旧提案', expectedRevision: 1 }))
      .rejects.toMatchObject({ statusCode: 409, code: 'MEMORY_CONFLICT' })
    expect(db.memoryUpdate).not.toHaveBeenCalled()
  })

  it('只更新传入字段，空更新抛 400', async () => {
    db.memoryFindFirst.mockResolvedValue({ id: 'm1', userId: 'u1', revision: 1 })
    db.memoryUpdate.mockImplementation(({ data }) => Promise.resolve({ id: 'm1', ...data, entities: null, tags: '[]' }))

    await updateMemory('u1', 'm1', { importance: 8, expectedRevision: 1 })
    expect(db.memoryUpdate).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { importance: 8, revision: { increment: 1 } },
    })

    await expect(updateMemory('u1', 'm1', { expectedRevision: 1 })).rejects.toMatchObject({
      statusCode: 400,
      message: '没有可更新的记忆字段',
    })

    await expect(updateMemory('u1', 'm1', { type: 'wild' })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('更新前校验归属', async () => {
    db.memoryFindFirst.mockResolvedValue(null)
    await expect(updateMemory('u2', 'm1', { importance: 8 })).rejects.toMatchObject({
      statusCode: 404,
      message: '记忆不存在',
    })
    expect(db.memoryUpdate).not.toHaveBeenCalled()
  })
  it('改内容触发投影重建，只改标签/重要度不触发', async () => {
    db.memoryFindFirst.mockResolvedValue({ id: 'm1', userId: 'u1', revision: 1 })
    db.memoryUpdate.mockImplementation(({ data }) => Promise.resolve({ id: 'm1', userId: 'u1', content: '新内容', ...data, entities: null, tags: '[]' }))

    await updateMemory('u1', 'm1', { tags: ['换标签'], expectedRevision: 1 })
    expect(embedding.embedMemory).not.toHaveBeenCalled()

    await updateMemory('u1', 'm1', { content: '新内容', expectedRevision: 1 })
    expect(embedding.embedMemory).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1', content: '新内容' }))
  })

  it('内容更新与旧向量失效原子保存，新投影失败也不会保留旧向量', async () => {
    let stored = { id: 'm1', userId: 'u1', revision: 1, content: '旧内容', embedding: [1, 2], embeddingModel: 'old-model', entities: null, tags: '[]' }
    db.memoryFindFirst.mockResolvedValue(stored)
    db.memoryUpdate.mockImplementation(({ data }) => {
      stored = { ...stored, ...data }
      return Promise.resolve(stored)
    })
    embedding.embedMemory.mockResolvedValue(false)

    const memory = await updateMemory('u1', 'm1', { content: '新内容', expectedRevision: 1 })

    expect(db.memoryUpdate).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { content: '新内容', embedding: [], embeddingModel: null, revision: { increment: 1 } },
    })
    expect(stored).toMatchObject({ content: '新内容', embedding: [], embeddingModel: null })
    expect(embedding.embedMemory).toHaveBeenCalledWith(expect.objectContaining({ content: '新内容', embedding: [] }))
    expect(memory).not.toHaveProperty('embedding')
  })

})

describe('deleteMemory', () => {
  it('删除前校验归属', async () => {
    db.memoryFindFirst.mockResolvedValue({ id: 'm1', userId: 'u1' })
    await deleteMemory('u1', 'm1')
    expect(db.memoryDeleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', id: { in: ['m1'] } } })

    db.memoryFindFirst.mockResolvedValue(null)
    await expect(deleteMemory('u2', 'm1')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('放在心上', () => {
  const memory = { id: 'm1', userId: 'u1', type: 'semantic', content: '我对芒果过敏', revision: 3, pinned: false, entities: null, tags: null }

  it('放上去不改内容、不升版本、不写修订记录', async () => {
    db.memoryFindFirst.mockResolvedValue(memory)
    db.memoryCount.mockResolvedValue(2)
    db.memoryUpdate.mockImplementation(({ data }) => Promise.resolve({ ...memory, ...data }))

    const pinned = await setMemoryPinned('u1', 'm1', true)

    expect(db.memoryUpdate).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { pinned: true } })
    expect(pinned).toMatchObject({ id: 'm1', pinned: true, revision: 3 })
  })

  it('最多 5 件；满了再放如实拒绝', async () => {
    db.memoryFindFirst.mockResolvedValue(memory)
    db.memoryCount.mockResolvedValue(5)

    await expect(setMemoryPinned('u1', 'm1', true)).rejects.toMatchObject({ statusCode: 400, message: '最多放 5 件在心上，先拿下一件再放' })
    expect(db.memoryUpdate).not.toHaveBeenCalled()
  })

  it('拿下来不受上限影响；已经是那个状态就什么也不写', async () => {
    db.memoryFindFirst.mockResolvedValue({ ...memory, pinned: true })
    db.memoryCount.mockResolvedValue(5)
    db.memoryUpdate.mockImplementation(({ data }) => Promise.resolve({ ...memory, ...data }))

    await setMemoryPinned('u1', 'm1', false)
    expect(db.memoryUpdate).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { pinned: false } })

    db.memoryUpdate.mockClear()
    db.memoryFindFirst.mockResolvedValue(memory)
    await setMemoryPinned('u1', 'm1', false)
    expect(db.memoryUpdate).not.toHaveBeenCalled()
  })

  it('不是自己的记忆是 404；pinned 不是布尔值是 400', async () => {
    db.memoryFindFirst.mockResolvedValue(null)
    await expect(setMemoryPinned('u1', 'someone-else', true)).rejects.toMatchObject({ statusCode: 404 })
    await expect(setMemoryPinned('u1', 'm1', 'yes')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('列表把放在心上的排在最前', async () => {
    db.memoryCount.mockResolvedValue(0)
    await listMemories('u1')
    expect(db.memoryFindMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ pinned: 'desc' }, { importance: 'desc' }, { createdAt: 'desc' }],
    }))
  })
})
