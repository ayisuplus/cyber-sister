import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({ default: { collectionItem: db } }))
vi.mock('../utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { createItem, deleteItem, listForHer, listItems, MAX_COLLECTION_ITEMS, readPhoto, updateItem } from './collectionService.js'

const segment = (marker, body) => {
  const payload = Buffer.from(body)
  const head = Buffer.from([0xff, marker, 0, 0])
  head.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([head, payload])
}
const SCAN = Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x00, 0x12, 0x34, 0xff, 0xd9])
const jpeg = (label) => Buffer.concat([Buffer.from([0xff, 0xd8]), segment(0xe1, `Exif GPS 31.23N ${label}`), segment(0xdb, [1, 2]), SCAN])
const files = (photo = jpeg('photo'), thumb = jpeg('thumb')) => ({ photo: [{ buffer: photo }], thumb: [{ buffer: thumb }] })
const NOW = new Date('2026-09-21T12:00:00.000Z')
const row = (overrides = {}) => ({
  id: 'item-1', userId: 'u1', shelf: 'wardrobe', category: null, name: '白衬衫', note: null, status: 'have', link: null, imageExt: null,
  createdAt: NOW, updatedAt: NOW, ...overrides,
})

describe('收藏', () => {
  let root
  let env

  beforeEach(async () => {
    vi.clearAllMocks()
    root = await mkdtemp(join(tmpdir(), 'collection-'))
    env = { COLLECTION_DIR: root }
    db.count.mockResolvedValue(0)
    db.create.mockImplementation(({ data }) => Promise.resolve(row({ ...data, id: 'item-1' })))
    db.update.mockImplementation(({ data }) => Promise.resolve(row({ ...data })))
    db.delete.mockResolvedValue({})
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('有照片的一件：行里只记 .jpg，文件存在用户目录下，拍摄信息已经去掉', async () => {
    const item = await createItem('u1', { shelf: 'wardrobe', name: ' 白衬衫 ', category: '上衣' }, files(), env)

    expect(db.create).toHaveBeenCalledWith({ data: { userId: 'u1', shelf: 'wardrobe', name: '白衬衫', status: 'have', category: '上衣', imageExt: '.jpg' } })
    expect(item).toMatchObject({ name: '白衬衫', status: 'have', photoUrl: `/api/collection/item-1/photo?v=${NOW.getTime()}`, thumbUrl: `/api/collection/item-1/thumb?v=${NOW.getTime()}` })
    expect((await readdir(join(root, 'u1'))).sort()).toEqual(['item-1.jpg', 'item-1.thumb.jpg'])
    for (const name of ['item-1.jpg', 'item-1.thumb.jpg']) {
      const saved = await readFile(join(root, 'u1', name))
      expect(saved.includes('GPS')).toBe(false)
      expect(saved.subarray(saved.length - SCAN.length)).toEqual(SCAN)
    }
  })

  it('没照片的一件（比如粘贴的链接）：只存链接和名字，不去打开它', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const item = await createItem('u1', { shelf: 'makeup', name: '雾面唇釉', status: 'want', link: 'https://m.tb.cn/h.abc?tk=1' }, {}, env)

    expect(db.create.mock.calls[0][0].data).toMatchObject({ shelf: 'makeup', status: 'want', link: 'https://m.tb.cn/h.abc?tk=1', imageExt: null })
    expect(item).toMatchObject({ photoUrl: null, thumbUrl: null, link: 'https://m.tb.cn/h.abc?tk=1' })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it.each([
    [{ shelf: 'kitchen', name: '碗' }, '只能放进衣柜或化妆间'],
    [{ shelf: 'wardrobe', name: '  ' }, '给它起个名字吧'],
    [{ shelf: 'wardrobe', name: '长'.repeat(41) }, '名字最多 40 个字'],
    [{ shelf: 'wardrobe', name: '裙子', category: '唇妆' }, '没有这个分类'],
    [{ shelf: 'wardrobe', name: '裙子', status: 'maybe' }, '只能标成「想要」或「已有」'],
    [{ shelf: 'wardrobe', name: '裙子', note: '字'.repeat(301) }, '备注最多 300 个字'],
    [{ shelf: 'wardrobe', name: '裙子', link: 'javascript:alert(1)' }, '这不是一个能打开的链接'],
    [{ shelf: 'wardrobe', name: '裙子', link: 'file:///etc/passwd' }, '这不是一个能打开的链接'],
    [{ shelf: 'wardrobe', name: '裙子', link: '不是链接' }, '这不是一个能打开的链接'],
  ])('逐项校验 %j', async (fields, message) => {
    await expect(createItem('u1', fields, {}, env)).rejects.toMatchObject({ statusCode: 400, message })
    expect(db.create).not.toHaveBeenCalled()
  })

  it('照片只收 JPEG，原图和缩略图要一起来，太大的拒绝', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await expect(createItem('u1', { shelf: 'wardrobe', name: '鞋' }, files(png), env)).rejects.toMatchObject({ statusCode: 400 })
    await expect(createItem('u1', { shelf: 'wardrobe', name: '鞋' }, { photo: [{ buffer: jpeg('p') }] }, env)).rejects.toMatchObject({ statusCode: 400, message: '照片和缩略图要一起上传' })
    const hugeThumb = Buffer.concat([jpeg('t'), Buffer.alloc(600 * 1024)])
    await expect(createItem('u1', { shelf: 'wardrobe', name: '鞋' }, files(jpeg('p'), hugeThumb), env)).rejects.toMatchObject({ statusCode: 400 })
    expect(db.create).not.toHaveBeenCalled()
  })

  it(`满 ${MAX_COLLECTION_ITEMS} 件就如实拒绝`, async () => {
    db.count.mockResolvedValue(MAX_COLLECTION_ITEMS)
    await expect(createItem('u1', { shelf: 'wardrobe', name: '外套' }, {}, env)).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('满 500 件') })
    expect(db.create).not.toHaveBeenCalled()
  })

  it('写照片失败就把刚建的行删掉，不留有行没图的空记录', async () => {
    // 让用户目录变成一个文件，mkdir 必然失败
    await writeFile(join(root, 'u1'), 'not a directory')
    await expect(createItem('u1', { shelf: 'wardrobe', name: '外套' }, files(), env)).rejects.toBeTruthy()
    expect(db.delete).toHaveBeenCalledWith({ where: { id: 'item-1' } })
  })

  it('列表按柜子取，新的在前；柜子写错就拒绝', async () => {
    db.findMany.mockResolvedValue([row({ imageExt: '.jpg' })])
    const items = await listItems('u1', 'wardrobe')
    expect(db.findMany).toHaveBeenCalledWith({ where: { userId: 'u1', shelf: 'wardrobe' }, orderBy: { createdAt: 'desc' }, take: MAX_COLLECTION_ITEMS })
    expect(items[0].thumbUrl).toContain('/api/collection/item-1/thumb')
    await expect(listItems('u1', 'garage')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('改文字、换照片都行，柜子不能换；别人的读不到、改不了、删不掉', async () => {
    db.findFirst.mockResolvedValue(row())
    await updateItem('u1', 'item-1', { status: 'want', note: '  S 码 ', shelf: 'makeup' }, {}, env)
    expect(db.update).toHaveBeenCalledWith({ where: { id: 'item-1' }, data: { status: 'want', note: 'S 码' } })

    await updateItem('u1', 'item-1', {}, files(), env)
    expect(db.update).toHaveBeenLastCalledWith({ where: { id: 'item-1' }, data: { imageExt: '.jpg' } })
    expect(await readdir(join(root, 'u1'))).toHaveLength(2)

    db.findFirst.mockResolvedValue(null)
    await expect(updateItem('u2', 'item-1', { name: '偷改' }, {}, env)).rejects.toMatchObject({ statusCode: 404 })
    await expect(readPhoto('u2', 'item-1', 'photo', env)).rejects.toMatchObject({ statusCode: 404 })
    await expect(deleteItem('u2', 'item-1', env)).rejects.toMatchObject({ statusCode: 404 })
    expect(db.findFirst).toHaveBeenLastCalledWith({ where: { id: 'item-1', userId: 'u2' } })
    expect(db.delete).not.toHaveBeenCalled()
  })

  it('读照片与缩略图；删除时连文件一起删', async () => {
    db.findFirst.mockResolvedValue(row())
    await updateItem('u1', 'item-1', {}, files(jpeg('big'), jpeg('small')), env)
    db.findFirst.mockResolvedValue(row({ imageExt: '.jpg' }))

    const photo = await readPhoto('u1', 'item-1', 'photo', env)
    expect(photo.mime).toBe('image/jpeg')
    expect(photo.buffer.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]))
    expect((await readPhoto('u1', 'item-1', 'thumb', env)).buffer.equals(photo.buffer)).toBe(true)

    await deleteItem('u1', 'item-1', env)
    expect(db.delete).toHaveBeenCalledWith({ where: { id: 'item-1' } })
    expect(await readdir(join(root, 'u1'))).toEqual([])

    db.findFirst.mockResolvedValue(row({ imageExt: null }))
    await expect(readPhoto('u1', 'item-1', 'photo', env)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('给她看的只有名字、柜子、分类、想要/已有和备注，没有照片和链接', async () => {
    db.count.mockResolvedValue(2)
    db.findMany.mockResolvedValue([
      { name: '雾面唇釉', shelf: 'makeup', category: '唇妆', status: 'want', note: '色号 03' },
      { name: '白衬衫', shelf: 'wardrobe', category: null, status: 'have', note: null },
    ])
    const seen = await listForHer('u1', { shelf: 'all', status: 'all' })

    expect(db.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' }, orderBy: { createdAt: 'desc' }, take: 60,
      select: { name: true, shelf: true, category: true, status: true, note: true },
    })
    expect(seen).toEqual({ total: 2, items: [
      { name: '雾面唇釉', shelf: '化妆间', category: '唇妆', status: '想要', note: '色号 03' },
      { name: '白衬衫', shelf: '衣柜', category: null, status: '已有', note: null },
    ] })

    await listForHer('u1', { shelf: 'wardrobe', status: 'want', category: '鞋' })
    expect(db.count).toHaveBeenLastCalledWith({ where: { userId: 'u1', shelf: 'wardrobe', status: 'want', category: '鞋' } })
  })
})
