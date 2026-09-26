import { Buffer } from 'node:buffer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ findUnique: vi.fn() }))
const gateway = vi.hoisted(() => ({ complete: vi.fn() }))

const reference = vi.hoisted(() => ({ index: null }))
vi.mock('../prisma/client.js', () => ({ default: { user: { findUnique: db.findUnique } } }))
// 测试不读这台电脑上真的名录：按用例给一份小索引或者没有
vi.mock('./plantReference.js', async (importOriginal) => ({ ...(await importOriginal()), loadPlantReference: () => reference.index }))
vi.mock('../utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('./llmService.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getGateway: vi.fn(async () => gateway),
    // 真实的门还看供应商有没有配；这里只关心同意
    assertCloudCallable: vi.fn((allow) => { if (!allow) throw new actual.CloudConsentRequiredError() }),
  }
})

import { identifyPlant, readIdentification } from './plantIdService.js'
import { indexReference } from './plantReference.js'

const segment = (marker, body) => {
  const payload = Buffer.from(body)
  const head = Buffer.from([0xff, marker, 0, 0])
  head.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([head, payload])
}
const SCAN = Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x00, 0x12, 0x34, 0xff, 0xd9])
const JPEG_WITH_GPS = Buffer.concat([Buffer.from([0xff, 0xd8]), segment(0xe1, 'Exif GPS 31.23N'), segment(0xdb, [1, 2]), SCAN])
const photo = (buffer = JPEG_WITH_GPS) => ({ photo: [{ buffer }] })
const CONSENTED = { persona: 'cool', externalLlmConsent: true, externalLlmConsentVersion: 'cloud-primary-v4' }
const ANSWER = JSON.stringify({
  isPlant: true,
  candidates: [{ name: '栀子花', scientificName: 'Gardenia jasminoides', family: '茜草科', likelihood: '很像' }],
  explanation: { what: '夏天的白花，香。', howToTell: '花瓣厚，像蜡。', season: '五到七月', lore: '民间说法：一生的守候。', care: '喜酸性土。' },
  caution: null,
})

beforeEach(() => {
  vi.clearAllMocks()
  reference.index = null
  db.findUnique.mockResolvedValue(CONSENTED)
  gateway.complete.mockResolvedValue({ content: ANSWER, model: 'qwen-vl-max' })
})

describe('认一认', () => {
  it('照片去掉拍摄信息后发给聊天那个模型：她的说话方式、提示词、一张图；带回候选、讲解、版本和模型名', async () => {
    const result = await identifyPlant('u1', photo(), { requestId: 'req-1' })

    const request = gateway.complete.mock.calls[0][0]
    expect(request).toMatchObject({ scene: 'chat', persona: 'cool', requestId: 'req-1', allowExternal: true })
    expect(typeof request.authorizeExternal).toBe('function')
    expect(request.systemAppend[0].content).toContain('【认花草】')
    const [text, image] = request.messages[0].content
    expect(text.type).toBe('text')
    const sent = Buffer.from(image.image_url.url.replace('data:image/jpeg;base64,', ''), 'base64')
    expect(sent.includes('GPS')).toBe(false)
    expect(result).toMatchObject({
      isPlant: true, promptVersion: 'plant-id-v1', identifiedBy: 'qwen-vl-max',
      candidates: [{ name: '栀子花', likelihood: '很像' }], explanation: { season: '五到七月' },
    })
  })

  it('没装名录就不核：reference 如实写着没核；装了就按学名核到名录里那一种，并挂上毒性记载', async () => {
    expect((await identifyPlant('u1', photo())).reference).toMatchObject({ checked: false, toxicChecked: false })

    reference.index = indexReference({
      taxa: [{ cn: '栀子', sci: 'Gardenia jasminoides', family: '茜草科', aliases: ['栀子花'] }],
      toxic: [{ taxon: 0, cn: '栀子', sci: 'Gardenia jasminoides', level: '小毒', parts: ['果实'] }],
      sources: { checklist: { title: '名录' } },
    })
    const grounded = await identifyPlant('u1', photo())
    expect(grounded.candidates[0].name).toBe('栀子花')
    expect(grounded.reference).toMatchObject({
      checked: true, toxicChecked: true,
      candidates: [{ found: true, standardName: '栀子', scientificName: 'Gardenia jasminoides', via: 'scientific' }],
      toxic: [{ candidate: 0, name: '栀子', level: '小毒', parts: ['果实'] }],
    })
  })

  it('没同意云端就不调模型', async () => {
    db.findUnique.mockResolvedValue({ ...CONSENTED, externalLlmConsentVersion: 'cloud-primary-v3' })
    await expect(identifyPlant('u1', photo())).rejects.toMatchObject({ code: 'CLOUD_NOT_CONSENTED', statusCode: 503 })
    expect(gateway.complete).not.toHaveBeenCalled()
  })

  it('没照片、不是 JPEG 的在调模型之前拒绝', async () => {
    await expect(identifyPlant('u1', {})).rejects.toMatchObject({ statusCode: 400, message: '先拍一张或选一张照片' })
    await expect(identifyPlant('u1', photo(Buffer.from('not a jpeg')))).rejects.toMatchObject({ statusCode: 400 })
    expect(gateway.complete).not.toHaveBeenCalled()
  })

  it('模型没回话是 503，回了但读不出形状是 502，都带 code', async () => {
    gateway.complete.mockResolvedValueOnce(null)
    await expect(identifyPlant('u1', photo())).rejects.toMatchObject({ statusCode: 503, code: 'LLM_UNAVAILABLE' })
    gateway.complete.mockResolvedValueOnce({ content: '这是一朵很好看的花呀', model: 'm' })
    await expect(identifyPlant('u1', photo())).rejects.toMatchObject({ statusCode: 502, code: 'PLANT_ID_UNREADABLE' })
  })

  it('读回答：套了代码块也认，不是植物照实说，能吃能入药的段落去掉', () => {
    expect(readIdentification('```json\n{"isPlant": false}\n```', 'm')).toMatchObject({ isPlant: false, candidates: [], identifiedBy: 'm' })
    const risky = readIdentification(JSON.stringify({
      candidates: [{ name: '金银花', likelihood: '可能是' }],
      explanation: { what: '藤本，花先白后黄。', care: '花可以泡水喝。' },
    }), 'm')
    expect(risky.explanation).toMatchObject({ what: '藤本，花先白后黄。', care: null })
  })
})
