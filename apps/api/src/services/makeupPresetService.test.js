import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  presetFindMany: vi.fn(),
  presetCreate: vi.fn(),
  presetUpdate: vi.fn(),
  presetFindFirst: vi.fn(),
  presetDelete: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    makeupPreset: {
      findMany: db.presetFindMany,
      create: db.presetCreate,
      update: db.presetUpdate,
      findFirst: db.presetFindFirst,
      delete: db.presetDelete,
    },
  },
}))

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  createPreset,
  deletePreset,
  listPresets,
  renamePreset,
} from './makeupPresetService.js'

beforeEach(() => vi.clearAllMocks())

const VALID_SETTINGS = { smooth: 30, whiten: 20, slim: 10, eye: 10 }

describe('妆容预设', () => {
  it('listPresets 按创建时间升序返回当前用户预设', async () => {
    db.presetFindMany.mockResolvedValue([{ id: 'p1' }])

    const result = await listPresets('user-1')

    expect(db.presetFindMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'asc' },
    })
    expect(result).toEqual([{ id: 'p1' }])
  })

  it('createPreset 校验通过后落库并 trim 名字', async () => {
    db.presetCreate.mockImplementation(async ({ data }) => ({ id: 'p1', ...data }))

    const created = await createPreset('user-1', { name: '  日常  ', ...VALID_SETTINGS })

    expect(db.presetCreate).toHaveBeenCalledWith({
      data: { userId: 'user-1', name: '日常', ...VALID_SETTINGS },
    })
    expect(created.name).toBe('日常')
  })

  it.each([
    [{ name: '日常', smooth: -1, whiten: 20, slim: 10, eye: 10 }],
    [{ name: '日常', smooth: 30, whiten: 101, slim: 10, eye: 10 }],
    [{ name: '日常', smooth: 30, whiten: 20, slim: 1.5, eye: 10 }],
    [{ name: '日常', smooth: 30, whiten: 20, slim: 10 }],
  ])('createPreset 非法参数 %# → 400', async (body) => {
    await expect(createPreset('user-1', body))
      .rejects.toMatchObject({ statusCode: 400, message: '妆容参数需为 0-100 的整数' })
    expect(db.presetCreate).not.toHaveBeenCalled()
  })

  it.each([
    [''],
    ['   '],
    ['这是一个非常非常非常非常非常长的妆容名字哦'],
  ])('createPreset 非法名字 %# → 400', async (name) => {
    await expect(createPreset('user-1', { name, ...VALID_SETTINGS }))
      .rejects.toMatchObject({ statusCode: 400, message: '妆容名字需为 1-20 个字' })
    expect(db.presetCreate).not.toHaveBeenCalled()
  })

  it('renamePreset 命中归属后改名', async () => {
    db.presetFindFirst.mockResolvedValue({ id: 'p1', userId: 'user-1' })
    db.presetUpdate.mockImplementation(async ({ data }) => ({ id: 'p1', ...data }))

    const updated = await renamePreset('user-1', 'p1', { name: '新名字' })

    expect(db.presetFindFirst).toHaveBeenCalledWith({ where: { id: 'p1', userId: 'user-1' } })
    expect(db.presetUpdate).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { name: '新名字' } })
    expect(updated.name).toBe('新名字')
  })

  it('renamePreset 非本人预设 → 404', async () => {
    db.presetFindFirst.mockResolvedValue(null)

    await expect(renamePreset('user-1', 'p1', { name: '新名字' }))
      .rejects.toMatchObject({ statusCode: 404, message: '妆容预设不存在' })
    expect(db.presetUpdate).not.toHaveBeenCalled()
  })

  it('deletePreset 命中归属后删除；非本人 → 404', async () => {
    db.presetFindFirst.mockResolvedValue({ id: 'p1', userId: 'user-1' })
    db.presetDelete.mockResolvedValue({ id: 'p1' })

    await expect(deletePreset('user-1', 'p1')).resolves.toBeUndefined()
    expect(db.presetDelete).toHaveBeenCalledWith({ where: { id: 'p1' } })

    db.presetFindFirst.mockResolvedValue(null)
    await expect(deletePreset('user-1', 'p1'))
      .rejects.toMatchObject({ statusCode: 404, message: '妆容预设不存在' })
  })
})
