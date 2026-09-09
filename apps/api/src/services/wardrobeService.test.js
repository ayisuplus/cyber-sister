import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  itemFindMany: vi.fn(),
  itemCreate: vi.fn(),
  itemFindFirst: vi.fn(),
  itemDelete: vi.fn(),
}))

const imageTo3d = vi.hoisted(() => ({
  generateModel: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    wardrobeItem: {
      findMany: db.itemFindMany,
      create: db.itemCreate,
      findFirst: db.itemFindFirst,
      delete: db.itemDelete,
    },
  },
}))

vi.mock('./imageTo3dService.js', () => imageTo3d)

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { createItem, deleteItem, listItems, readItemFile } from './wardrobeService.js'

const PNG = Buffer.from([0x89, 0x50, 1, 2, 3])
const GLB = Buffer.from([0x67, 0x6c, 0x54, 0x46]) // 'glTF'
const NOT_CONFIGURED = Object.assign(new Error('3D 生成服务还没接好，开放后第一时间告诉你'), {
  statusCode: 503,
  code: 'IMAGE_TO_3D_NOT_CONFIGURED',
})

describe('wardrobeService', () => {
  let root
  let env

  beforeEach(async () => {
    vi.clearAllMocks()
    root = await mkdtemp(join(tmpdir(), 'wardrobe-'))
    env = { WARDROBE_DIR: root }
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('未配置 3D 服务：createItem 抛 503，不落行也不写文件', async () => {
    imageTo3d.generateModel.mockRejectedValue(NOT_CONFIGURED)

    await expect(createItem('u1', { name: '风衣', buffer: PNG, mime: 'image/png' }, env))
      .rejects.toMatchObject({ statusCode: 503, code: 'IMAGE_TO_3D_NOT_CONFIGURED' })
    expect(db.itemCreate).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual([])
  })
  it('配置后全闭环：建行、两个文件落地、list 含 url、可读回、删除清目录', async () => {
    imageTo3d.generateModel.mockResolvedValue({ modelBuffer: GLB })
    db.itemCreate.mockImplementation(async ({ data }) => ({ id: 'item-1', createdAt: '2026-09-08', ...data }))
    db.itemFindFirst.mockImplementation(async () => (await db.itemCreate.mock.results[0]?.value) || null)

    const created = await createItem('u1', { name: ' 黑色风衣 ', buffer: PNG, mime: 'image/png' }, env)

    expect(db.itemCreate).toHaveBeenCalledWith({
      data: { userId: 'u1', name: '黑色风衣', sourceExt: '.png', modelExt: '.glb' },
    })
    expect(created).toEqual({
      id: 'item-1',
      name: '黑色风衣',
      createdAt: '2026-09-08',
      sourceUrl: '/api/wardrobe/item-1/source',
      modelUrl: '/api/wardrobe/item-1/model',
    })

    const dir = join(root, 'u1', 'item-1')
    expect((await readdir(dir)).sort()).toEqual(['model.glb', 'source.png'])
    expect((await readFile(join(dir, 'source.png'))).equals(PNG)).toBe(true)
    expect((await readFile(join(dir, 'model.glb'))).equals(GLB)).toBe(true)

    db.itemFindMany.mockResolvedValue([
      { id: 'item-1', userId: 'u1', name: '黑色风衣', sourceExt: '.png', modelExt: '.glb', createdAt: '2026-09-08' },
    ])
    const list = await listItems('u1')
    expect(db.itemFindMany).toHaveBeenCalledWith({ where: { userId: 'u1' }, orderBy: { createdAt: 'desc' } })
    expect(list[0].sourceUrl).toBe('/api/wardrobe/item-1/source')

    db.itemFindFirst.mockResolvedValue({ id: 'item-1', userId: 'u1', sourceExt: '.png' })
    const source = await readItemFile('u1', 'item-1', 'source', env)
    expect(source.mime).toBe('image/png')
    expect(source.buffer.equals(PNG)).toBe(true)
    const model = await readItemFile('u1', 'item-1', 'model', env)
    expect(model.mime).toBe('model/gltf-binary')
    expect(model.buffer.equals(GLB)).toBe(true)

    db.itemDelete.mockResolvedValue({ id: 'item-1' })
    await deleteItem('u1', 'item-1', env)
    expect(db.itemDelete).toHaveBeenCalledWith({ where: { id: 'item-1' } })
    expect(await readdir(join(root, 'u1'))).toEqual([])
  })

  it('缺省名字落「未命名单品」；非法 mime → 400', async () => {
    imageTo3d.generateModel.mockResolvedValue({ modelBuffer: GLB })
    db.itemCreate.mockImplementation(async ({ data }) => ({ id: 'item-2', createdAt: 't', ...data }))

    const created = await createItem('u1', { name: '   ', buffer: PNG, mime: 'image/jpeg' }, env)
    expect(created.name).toBe('未命名单品')

    await expect(createItem('u1', { name: 'x', buffer: PNG, mime: 'image/gif' }, env))
      .rejects.toMatchObject({ statusCode: 400, message: '仅支持 JPEG/PNG/WebP 图片' })
  })

  it('readItemFile 非本人单品 → 404；非法 kind → 400', async () => {
    db.itemFindFirst.mockResolvedValue(null)

    await expect(readItemFile('u1', 'item-9', 'source', env))
      .rejects.toMatchObject({ statusCode: 404, message: '单品不存在' })
    await expect(readItemFile('u1', 'item-9', 'thumbnail', env))
      .rejects.toMatchObject({ statusCode: 400, message: '不支持的文件类型' })
    expect(db.itemFindFirst).toHaveBeenCalledTimes(1) // kind 校验在归属查询之前
  })
})
