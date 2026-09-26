import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import {
  fullNameKey, groundIdentification, indexReference, loadPlantReference, lookupTaxon, parseToxicText, REFERENCE_VERSION, resetPlantReference, scientificKey,
} from './plantReference.js'

// 自己编的一小份，不是真名录
const DATA = {
  version: REFERENCE_VERSION,
  sources: { checklist: { title: '名录（测试）' }, toxic: { title: '有毒植物（测试）' } },
  taxa: [
    { cn: '夹竹桃', sci: 'Nerium oleander', family: '夹竹桃科', aliases: ['欧洲夹竹桃'], scrutiny: '某专家 2020' },
    { cn: '秋英', sci: 'Cosmos bipinnatus', family: '菊科', aliases: ['波斯菊', '格桑花'] },
    { cn: '海芋', sci: 'Alocasia odora', family: '天南星科' },
    { cn: '白花', sci: 'Albus unus', family: '某科' },
    { cn: '白花', sci: 'Albus duo', family: '某科' },
    { cn: '水仙', sci: 'Narcissus tazetta var. chinensis', family: '石蒜科' },
    { cn: '欧洲水仙', sci: 'Narcissus tazetta', family: '石蒜科' },
    { cn: '热亚海芋', sci: 'Alocasia macrorrhizos', family: '天南星科' },
  ],
  synonyms: { 'nerium indicum': 0, 'alocasia macrorrhiza': 2 },
  toxic: [
    { taxon: 0, cn: '夹竹桃', sci: 'Nerium indicum', level: null, parts: [] },
    { taxon: 2, cn: '海芋', sci: 'Alocasia macrorrhiza', level: '有毒', parts: ['根茎'] },
    { cn: '乌头属', sci: 'Aconitum', level: '剧毒', parts: ['块根'] },
    { cn: '水仙', sci: 'Narcissus tazetta var. chinensis', level: '有毒', parts: [] },
  ],
}
const identified = (candidates) => ({ isPlant: true, candidates, explanation: null, caution: null })

describe('名录与毒性：学名与毒性摘录', () => {
  it('学名只取属 + 种：去掉命名人、变种和杂交符号；只有属名就是属名', () => {
    expect(scientificKey('Gardenia jasminoides J.Ellis')).toBe('gardenia jasminoides')
    expect(scientificKey('Narcissus tazetta var. chinensis')).toBe('narcissus tazetta')
    expect(scientificKey('Prunus × yedoensis')).toBe('prunus yedoensis')
    expect(scientificKey('Aconitum')).toBe('aconitum')
    expect(scientificKey('栀子')).toBeNull()
    expect(fullNameKey('Narcissus tazetta L. var. chinensis M.Roem.')).toBe('narcissus tazetta var chinensis')
    expect(fullNameKey('Aster tataricus f. robustus')).toBe('aster tataricus f robustus')
    expect(fullNameKey('Gardenia jasminoides J.Ellis')).toBe('gardenia jasminoides')
  })

  it('功用摘录里只取有没有毒、哪儿有毒；「解毒」「肿毒」不算', () => {
    expect(parseToxicText('种子有剧毒。')).toEqual({ level: '剧毒', parts: ['种子'] })
    expect(parseToxicText('块根有巨毒，经炮制后可入药')).toEqual({ level: '剧毒', parts: ['块根'] })
    expect(parseToxicText('叶、根可药用。花果有毒。')).toEqual({ level: '有毒', parts: ['花和果实'] })
    expect(parseToxicText('植株有毒，在国外用作杀鼠')).toEqual({ level: '有毒', parts: ['全株'] })
    expect(parseToxicText('全草入药，能利尿解毒，治无名肿毒')).toEqual({ level: null, parts: [] })
  })
})

describe('名录与毒性：核对', () => {
  const index = indexReference(DATA)

  it('按学名（含异名）找到名录里那一种；学名对不上再按中文名，只认唯一的一种', () => {
    expect(lookupTaxon(index, { name: '随便', scientificName: 'Nerium indicum Mill.' })).toEqual({ taxonIndex: 0, via: 'synonym' })
    expect(lookupTaxon(index, { name: '波斯菊', scientificName: null })).toEqual({ taxonIndex: 1, via: 'chinese' })
    expect(lookupTaxon(index, { name: '白花', scientificName: null })).toBeNull()
    expect(lookupTaxon(index, { name: '不存在的花', scientificName: 'Nullus nihil' })).toBeNull()
  })

  it('挂上 reference：不改她的候选；名录里的标准名、科、审核信息；毒性按这一种、按属、按中文名都认，同一条只写一次', () => {
    const result = groundIdentification(identified([
      { name: '欧洲夹竹桃', scientificName: 'Nerium oleander', family: null, likelihood: '很像' },
      { name: '夹竹桃', scientificName: 'Nerium indicum', family: null, likelihood: '可能是' },
      { name: '北乌头', scientificName: 'Aconitum kusnezoffii', family: null, likelihood: '拿不准' },
    ]), index)

    expect(result.candidates[0].name).toBe('欧洲夹竹桃')
    expect(result.reference).toMatchObject({
      checked: true, toxicChecked: true,
      candidates: [
        { found: true, standardName: '夹竹桃', scientificName: 'Nerium oleander', family: '夹竹桃科', scrutiny: '某专家 2020', via: 'scientific' },
        { found: true, standardName: '夹竹桃', via: 'synonym' },
        { found: false },
      ],
      toxic: [
        { candidate: 0, name: '夹竹桃', recordedAs: '夹竹桃', level: null, parts: [], by: 'species' },
        { candidate: 2, name: '北乌头', recordedAs: '乌头属', level: '剧毒', parts: ['块根'], by: 'genus' },
      ],
      sources: DATA.sources,
    })
  })

  it('同一种下有变种：完整学名对得上取那一行；只写到种时，她说的中文名和哪个变种一样就取哪个，否则取种本身', () => {
    expect(index.taxa[lookupTaxon(index, { name: '随便', scientificName: 'Narcissus tazetta var. chinensis' }).taxonIndex].cn).toBe('水仙')
    expect(index.taxa[lookupTaxon(index, { name: '水仙', scientificName: 'Narcissus tazetta' }).taxonIndex].cn).toBe('水仙')
    expect(index.taxa[lookupTaxon(index, { name: '洋水仙', scientificName: 'Narcissus tazetta' }).taxonIndex].cn).toBe('欧洲水仙')
  })

  it('学名对到了别的一种，她说的名字在毒性库里有记载，也照样提醒', () => {
    const result = groundIdentification(identified([{ name: '海芋', scientificName: 'Alocasia macrorrhizos', family: null, likelihood: '很像' }]), index)
    expect(result.reference.candidates[0]).toMatchObject({ found: true, standardName: '热亚海芋' })
    expect(result.reference.toxic).toMatchObject([{ candidate: 0, recordedAs: '海芋', level: '有毒' }])
  })

  it('名录里没有、毒性库里按学名或中文名有的，照样提醒', () => {
    const noChecklist = indexReference({ toxic: DATA.toxic })
    const result = groundIdentification(identified([{ name: '水仙', scientificName: 'Narcissus tazetta', family: null, likelihood: '很像' }]), noChecklist)
    expect(result.reference).toMatchObject({ checked: false, toxicChecked: true, candidates: [{ found: false }], toxic: [{ candidate: 0, level: '有毒' }] })
    const byName = groundIdentification(identified([{ name: '水仙', scientificName: null, family: null, likelihood: '很像' }]), noChecklist)
    expect(byName.reference.toxic).toHaveLength(1)
  })

  it('没有资料：如实写着没核；不是植物的原样返回', () => {
    expect(groundIdentification(identified([{ name: '栀子花' }]), null).reference).toEqual({ checked: false, toxicChecked: false, candidates: [], toxic: [], sources: {} })
    const notPlant = { isPlant: false, candidates: [] }
    expect(groundIdentification(notPlant, indexReference(DATA))).toBe(notPlant)
  })
})

describe('名录与毒性：本机文件', () => {
  let dir
  afterEach(() => {
    resetPlantReference()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('没有文件就是 null；有就读进来并缓存；版本对不上或坏了也是 null', () => {
    dir = mkdtempSync(join(tmpdir(), 'plant-ref-'))
    const file = join(dir, 'plant-reference.json')
    expect(loadPlantReference({ PLANT_REFERENCE_FILE: file })).toBeNull()

    writeFileSync(file, JSON.stringify(DATA))
    const index = loadPlantReference({ PLANT_REFERENCE_FILE: file })
    expect(index.taxa).toHaveLength(DATA.taxa.length)
    expect(loadPlantReference({ PLANT_REFERENCE_FILE: file })).toBe(index)

    resetPlantReference()
    writeFileSync(file, JSON.stringify({ ...DATA, version: 0 }))
    expect(loadPlantReference({ PLANT_REFERENCE_FILE: file })).toBeNull()
    writeFileSync(file, '{坏了')
    expect(loadPlantReference({ PLANT_REFERENCE_FILE: file })).toBeNull()
  })
})
