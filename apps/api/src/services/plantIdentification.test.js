import { describe, expect, it } from 'vitest'
import { clip, normalizeIdentification } from './plantIdentification.js'

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
