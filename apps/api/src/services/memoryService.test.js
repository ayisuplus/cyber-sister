import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  memoryFindMany: vi.fn(),
  memoryCount: vi.fn(),
  memoryCreate: vi.fn(),
  memoryFindFirst: vi.fn(),
  memoryUpdate: vi.fn(),
  memoryDelete: vi.fn(),
  memoryDeleteMany: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    memory: {
      findMany: db.memoryFindMany,
      count: db.memoryCount,
      create: db.memoryCreate,
      findFirst: db.memoryFindFirst,
      update: db.memoryUpdate,
      delete: db.memoryDelete,
      deleteMany: db.memoryDeleteMany,
    },
  },
}))

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  clearAllMemories,
  createMemory,
  deleteMemory,
  listMemories,
  updateMemory,
} from './memoryService.js'

beforeEach(() => vi.clearAllMocks())

describe('createMemory', () => {
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
  it('只更新传入字段，空更新抛 400', async () => {
    db.memoryFindFirst.mockResolvedValue({ id: 'm1', userId: 'u1' })
    db.memoryUpdate.mockImplementation(({ data }) => Promise.resolve({ id: 'm1', ...data, entities: null, tags: '[]' }))

    await updateMemory('u1', 'm1', { importance: 8 })
    expect(db.memoryUpdate).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { importance: 8 },
    })

    await expect(updateMemory('u1', 'm1', {})).rejects.toMatchObject({
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
})

describe('deleteMemory / clearAllMemories', () => {
  it('删除前校验归属', async () => {
    db.memoryFindFirst.mockResolvedValue({ id: 'm1', userId: 'u1' })
    await deleteMemory('u1', 'm1')
    expect(db.memoryDelete).toHaveBeenCalledWith({ where: { id: 'm1' } })

    db.memoryFindFirst.mockResolvedValue(null)
    await expect(deleteMemory('u2', 'm1')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('清空记忆返回删除数量', async () => {
    db.memoryDeleteMany.mockResolvedValue({ count: 7 })
    expect(await clearAllMemories('u1')).toBe(7)
    expect(db.memoryDeleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } })
  })
})
