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

vi.mock('../prisma/client.js', () => ({ default: { plantEntry: db } }))
vi.mock('../utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { createEntry, deleteEntry, listEntries, listForHer, MAX_PLANT_ENTRIES, readPhoto, updateEntry } from './gardenService.js'

const segment = (marker, body) => {
  const payload = Buffer.from(body)
  const head = Buffer.from([0xff, marker, 0, 0])
  head.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([head, payload])
}
const SCAN = Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x00, 0x12, 0x34, 0xff, 0xd9])
const jpeg = (label) => Buffer.concat([Buffer.from([0xff, 0xd8]), segment(0xe1, `Exif GPS 31.23N ${label}`), segment(0xdb, [1, 2]), SCAN])
const files = (photo = jpeg('photo'), thumb = jpeg('thumb')) => ({ photo: [{ buffer: photo }], thumb: [{ buffer: thumb }] })
const NOW = new Date('2026-09-26T12:00:00.000Z')
const row = (overrides = {}) => ({
  id: 'plant-1', userId: 'u1', name: '栀子花', scientificName: null, family: null, status: 'met', note: null,
  candidates: null, explanation: null, caution: null, promptVersion: null, identifiedBy: null, imageExt: null,
  createdAt: NOW, updatedAt: NOW, ...overrides,
})
const IDENTIFIED = {
  isPlant: true,
  candidates: [
    { name: '栀子花', scientificName: 'Gardenia jasminoides', family: '茜草科', likelihood: '很像' },
    { name: '白兰', scientificName: 'Michelia × alba', family: '木兰科', likelihood: '拿不准' },
  ],
  explanation: { what: '夏天开的白花，香得很浓。', howToTell: '花瓣厚、像蜡。', season: '五到七月', lore: '民间说它代表「一生的守候」。', care: '喜酸性土，别晒到正午的太阳。' },
  caution: null,
  promptVersion: 'plant-id-v1',
  identifiedBy: 'qwen-vl-max',
}

describe('花草图鉴', () => {
  let root
  let env

  beforeEach(async () => {
    vi.clearAllMocks()
    root = await mkdtemp(join(tmpdir(), 'garden-'))
    env = { GARDEN_DIR: root }
    db.count.mockResolvedValue(0)
    db.create.mockImplementation(({ data }) => Promise.resolve(row({ ...data, id: 'plant-1' })))
    db.update.mockImplementation(({ data }) => Promise.resolve(row({ ...data })))
    db.delete.mockResolvedValue({})
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('认过再收：选的是第一个候选，讲解、候选、提示词版本都留下；照片去掉拍摄信息存在用户目录下', async () => {
    const entry = await createEntry('u1', {
      name: ' 栀子花 ', scientificName: 'Gardenia jasminoides', family: '茜草科', note: '楼下花坛',
      identification: JSON.stringify(IDENTIFIED), pick: '0',
    }, files(), env)

    const { data } = db.create.mock.calls[0][0]
    expect(data).toMatchObject({
      userId: 'u1', name: '栀子花', status: 'met', note: '楼下花坛', imageExt: '.jpg',
      explanation: IDENTIFIED.explanation, promptVersion: 'plant-id-v1', identifiedBy: 'qwen-vl-max', caution: null,
    })
    expect(data.candidates).toHaveLength(2)
    expect(entry).toMatchObject({ name: '栀子花', identified: true, photoUrl: `/api/garden/plant-1/photo?v=${NOW.getTime()}` })
    expect((await readdir(join(root, 'u1'))).sort()).toEqual(['plant-1.jpg', 'plant-1.thumb.jpg'])
    for (const name of ['plant-1.jpg', 'plant-1.thumb.jpg']) {
      expect((await readFile(join(root, 'u1', name))).includes('GPS')).toBe(false)
    }
  })

  it('换了候选或自己写名字：讲解是照第一个候选写的，就不留；候选和提醒照留', async () => {
    const withCaution = { ...IDENTIFIED, caution: '全株有毒，别入口，家里有猫狗要放高一点。' }
    await createEntry('u1', { name: '白兰', identification: JSON.stringify(withCaution), pick: '1' }, {}, env)
    expect(db.create.mock.calls[0][0].data).toMatchObject({ name: '白兰', explanation: null, caution: withCaution.caution })
    expect(db.create.mock.calls[0][0].data.candidates).toHaveLength(2)

    await createEntry('u1', { name: '我家那盆', identification: JSON.stringify(IDENTIFIED) }, {}, env)
    expect(db.create.mock.calls[1][0].data.explanation).toBeNull()
  })

  it('不识别也能收：只写名字，没有识别结果', async () => {
    const entry = await createEntry('u1', { name: '无名小白花', status: 'grow' }, {}, env)
    expect(db.create).toHaveBeenCalledWith({ data: { userId: 'u1', name: '无名小白花', status: 'grow', imageExt: null } })
    expect(entry).toMatchObject({ identified: false, candidates: [], explanation: null, photoUrl: null })
  })

  it('带回来的识别结果按同一份形状校验：超长的截断、没有候选或不是植物的拒绝', async () => {
    const long = { ...IDENTIFIED, explanation: { ...IDENTIFIED.explanation, what: '长'.repeat(500) } }
    await createEntry('u1', { name: '栀子花', identification: JSON.stringify(long), pick: '0' }, {}, env)
    expect(Array.from(db.create.mock.calls[0][0].data.explanation.what)).toHaveLength(200)

    for (const identification of ['{不是 JSON', JSON.stringify({ isPlant: true, candidates: [] }), JSON.stringify({ isPlant: false })]) {
      await expect(createEntry('u1', { name: '栀子花', identification }, {}, env)).rejects.toMatchObject({ statusCode: 400, message: '识别结果读不出来，请重新认一次' })
    }
    expect(db.create).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ name: '  ' }, '给它写个名字吧'],
    [{ name: '长'.repeat(41) }, '名字最多 40 个字'],
    [{ name: '花', status: 'want' }, '只能标成「路上遇见」或「我养的」'],
    [{ name: '花', note: '字'.repeat(301) }, '备注最多 300 个字'],
    [{ name: '花', family: '科'.repeat(41) }, '科最多 40 个字'],
  ])('逐项校验 %j', async (fields, message) => {
    await expect(createEntry('u1', fields, {}, env)).rejects.toMatchObject({ statusCode: 400, message })
    expect(db.create).not.toHaveBeenCalled()
  })

  it('照片和缩略图要一起来；满了就如实拒绝', async () => {
    await expect(createEntry('u1', { name: '花' }, { photo: [{ buffer: jpeg('p') }] }, env)).rejects.toMatchObject({ statusCode: 400, message: '照片和缩略图要一起上传' })
    db.count.mockResolvedValue(MAX_PLANT_ENTRIES)
    await expect(createEntry('u1', { name: '花' }, {}, env)).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining(`满 ${MAX_PLANT_ENTRIES} 株`) })
    expect(db.create).not.toHaveBeenCalled()
  })

  it('写照片失败就把刚建的行删掉', async () => {
    await writeFile(join(root, 'u1'), 'not a directory')
    await expect(createEntry('u1', { name: '花' }, files(), env)).rejects.toBeTruthy()
    expect(db.delete).toHaveBeenCalledWith({ where: { id: 'plant-1' } })
  })

  it('列表新的在前，可以只看我养的；状态写错就拒绝', async () => {
    db.findMany.mockResolvedValue([row({ imageExt: '.jpg', candidates: IDENTIFIED.candidates, promptVersion: 'plant-id-v1' })])
    const entries = await listEntries('u1', 'grow')
    expect(db.findMany).toHaveBeenCalledWith({ where: { userId: 'u1', status: 'grow' }, orderBy: { createdAt: 'desc' }, take: MAX_PLANT_ENTRIES })
    expect(entries[0]).toMatchObject({ thumbUrl: expect.stringContaining('/api/garden/plant-1/thumb'), identified: true })
    await expect(listEntries('u1', 'dead')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('改文字、换照片都行，识别结果不能改；别人的读不到、改不了、删不掉', async () => {
    db.findFirst.mockResolvedValue(row())
    await updateEntry('u1', 'plant-1', { status: 'grow', note: ' 阳台 ', explanation: '{"what":"改"}', promptVersion: 'x' }, {}, env)
    expect(db.update).toHaveBeenCalledWith({ where: { id: 'plant-1' }, data: { status: 'grow', note: '阳台' } })

    await updateEntry('u1', 'plant-1', {}, files(), env)
    expect(db.update).toHaveBeenLastCalledWith({ where: { id: 'plant-1' }, data: { imageExt: '.jpg' } })

    db.findFirst.mockResolvedValue(null)
    await expect(updateEntry('u2', 'plant-1', { name: '偷改' }, {}, env)).rejects.toMatchObject({ statusCode: 404 })
    await expect(readPhoto('u2', 'plant-1', 'photo', env)).rejects.toMatchObject({ statusCode: 404 })
    await expect(deleteEntry('u2', 'plant-1', env)).rejects.toMatchObject({ statusCode: 404 })
    expect(db.findFirst).toHaveBeenLastCalledWith({ where: { id: 'plant-1', userId: 'u2' } })
    expect(db.delete).not.toHaveBeenCalled()
  })

  it('读照片；删除时连文件一起删', async () => {
    db.findFirst.mockResolvedValue(row())
    await updateEntry('u1', 'plant-1', {}, files(), env)
    db.findFirst.mockResolvedValue(row({ imageExt: '.jpg' }))
    expect((await readPhoto('u1', 'plant-1', 'thumb', env)).mime).toBe('image/jpeg')

    await deleteEntry('u1', 'plant-1', env)
    expect(db.delete).toHaveBeenCalledWith({ where: { id: 'plant-1' } })
    expect(await readdir(join(root, 'u1'))).toEqual([])
  })

  it('给她看的只有名字、科、遇见/养着、哪天和备注，没有照片与讲解；另报一共几种', async () => {
    db.count.mockResolvedValue(3)
    db.findMany.mockImplementation((args) => Promise.resolve(args.distinct
      ? [{ name: '栀子花' }, { name: '绿萝' }]
      : [
        { name: '栀子花', family: '茜草科', status: 'met', note: '楼下花坛', createdAt: new Date('2026-09-25T17:30:00Z') },
        { name: '绿萝', family: null, status: 'grow', note: null, createdAt: NOW },
      ]))
    const seen = await listForHer('u1')

    expect(db.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' }, orderBy: { createdAt: 'desc' }, take: 60,
      select: { name: true, family: true, status: true, note: true, createdAt: true },
    })
    // 北京时间 09-26 01:30 算 26 号
    expect(seen).toEqual({ total: 3, kinds: 2, items: [
      { name: '栀子花', family: '茜草科', status: '路上遇见', date: '2026-09-26', note: '楼下花坛' },
      { name: '绿萝', family: null, status: '我养的', date: '2026-09-26', note: null },
    ] })

    await listForHer('u1', { status: 'grow', keyword: '萝' })
    expect(db.count).toHaveBeenLastCalledWith({ where: {
      userId: 'u1', status: 'grow',
      OR: [{ name: { contains: '萝' } }, { family: { contains: '萝' } }, { note: { contains: '萝' } }],
    } })
  })
})
