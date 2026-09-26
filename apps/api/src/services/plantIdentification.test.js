import { describe, expect, it } from 'vitest'
import {
  applyPlantSafety, claimsEdible, clip, FUNGI_CAUTION, normalizeIdentification, PLANT_ID_PROMPT, PLANT_ID_PROMPT_VERSION,
} from './plantIdentification.js'

describe('识别结果的形状', () => {
  it('按字截断，不会把一个字劈成两半', () => {
    expect(clip('  🌸花花  ', 2)).toBe('🌸花')
    expect(clip('   ', 5)).toBeNull()
    expect(clip(42, 5)).toBeNull()
  })

  it('最多三个候选；没名字的候选丢掉；像不像只认三档，其余当「拿不准」', () => {
    const result = normalizeIdentification({
      candidates: [
        { name: '月季', scientificName: 'Rosa chinensis', family: '蔷薇科', likelihood: '很像' },
        { scientificName: 'Rosa rugosa' },
        { name: '玫瑰', likelihood: '90%' },
        { name: '蔷薇' },
        { name: '木香' },
      ],
      explanation: { what: '四季都开的花。', extra: '不要的字段' },
      promptVersion: 'plant-id-v1',
    })
    expect(result.isPlant).toBe(true)
    expect(result.candidates.map((c) => c.name)).toEqual(['月季', '玫瑰', '蔷薇'])
    expect(result.candidates[1]).toEqual({ name: '玫瑰', scientificName: null, family: null, likelihood: '拿不准' })
    expect(result.explanation).toEqual({ what: '四季都开的花。', howToTell: null, season: null, lore: null, care: null })
    expect(result.promptVersion).toBe('plant-id-v1')
  })

  it('不是植物：候选、讲解、提醒一律清空', () => {
    expect(normalizeIdentification({ isPlant: false, candidates: [{ name: '猫' }], caution: 'x', identifiedBy: 'm' }))
      .toEqual({ isPlant: false, candidates: [], explanation: null, caution: null, promptVersion: null, identifiedBy: 'm' })
  })

  it('形状不对或一个候选都没有就返回 null', () => {
    for (const raw of [null, 'text', [], { candidates: [] }, { candidates: 'x' }, { candidates: [{ name: ' ' }] }]) {
      expect(normalizeIdentification(raw)).toBeNull()
    }
  })

  it('讲解全空就当没有讲解', () => {
    expect(normalizeIdentification({ candidates: [{ name: '绿萝' }], explanation: { what: ' ' } }).explanation).toBeNull()
  })
})

describe('识别之后的兜底', () => {
  const identified = (overrides = {}) => normalizeIdentification({
    candidates: [{ name: '夹竹桃', scientificName: 'Nerium oleander', family: '夹竹桃科', likelihood: '很像' }],
    explanation: { what: '路边常见的开花灌木。', care: '喜光耐旱。' },
    caution: '全株有毒，别入口，家里有猫狗要小心。',
    ...overrides,
  })

  it('说能吃、能泡水、能入药的那一段整段去掉；「别吃」「不能泡水」这类劝阻保留', () => {
    expect(claimsEdible('嫩叶可以炒着吃')).toBe(true)
    expect(claimsEdible('花晒干可以泡茶，清热解毒')).toBe(true)
    expect(claimsEdible('千万不能吃，也别拿来泡水')).toBe(false)
    expect(claimsEdible('别吃它，不过花可以泡茶')).toBe(true)
    expect(claimsEdible('它不仅好看还能吃')).toBe(true)
    const result = applyPlantSafety(identified({ explanation: { what: '路边常见。', care: '花可以泡茶喝。', lore: '民间说它能入药。' } }))
    expect(result.explanation).toEqual({ what: '路边常见。', howToTell: null, season: null, lore: null, care: null })
    expect(result.caution).toBe('全株有毒，别入口，家里有猫狗要小心。')
  })

  it('红线判断由调用方给：命中的段落与提醒去掉，全去掉就当没有讲解', () => {
    const unsafe = (text) => text.includes('越线')
    const result = applyPlantSafety(identified({ explanation: { what: '越线的话' }, caution: '越线的提醒' }), { unsafe })
    expect(result.explanation).toBeNull()
    expect(result.caution).toBeNull()
  })

  it('像菌菇的：提醒换成固定那句，「想养的话」去掉', () => {
    const result = applyPlantSafety(identified({
      candidates: [{ name: '鸡枞菌', family: '离褶伞科', likelihood: '可能是' }],
      explanation: { what: '雨后林下常见。', care: '可以试着种在花盆里。' },
      caution: null,
    }))
    expect(result.caution).toBe(FUNGI_CAUTION)
    expect(result.explanation).toMatchObject({ what: '雨后林下常见。', care: null })
  })

  it('不是植物的原样放过', () => {
    const notPlant = normalizeIdentification({ isPlant: false })
    expect(applyPlantSafety(notPlant)).toBe(notPlant)
  })

  it('提示词写明了版本号和几条底线', () => {
    expect(PLANT_ID_PROMPT_VERSION).toBe('plant-id-v1')
    for (const rule of ['只输出一个 JSON 对象', '{"isPlant": false}', '拿不准', '能入药', '菌菇', '猫狗', '民间说法']) {
      expect(PLANT_ID_PROMPT).toContain(rule)
    }
  })
})
