import { describe, expect, it } from 'vitest'
import { parseArms, planComparisons, planGenerations } from './arms.js'
import { stylesOf } from './dataset.js'

const cases = [{ id: 'e01-a' }, { id: 'e02-b', personas: ['cool'] }]

describe('评测分组', () => {
  it('默认跑 A、B、C；写错的组直接报出来', () => {
    expect(parseArms()).toEqual(['A', 'B', 'C'])
    expect(parseArms('c, b ,c')).toEqual(['C', 'B'])
    expect(() => parseArms('A,Z')).toThrow('没有这一组：Z')
  })

  it('A 每个场景只生成一次，其余每种说话方式各一次', () => {
    const plan = planGenerations(cases, ['A', 'C'], stylesOf)
    expect(plan).toEqual([
      { caseId: 'e01-a', arm: 'A', style: null },
      { caseId: 'e01-a', arm: 'C', style: 'gentle' },
      { caseId: 'e01-a', arm: 'C', style: 'toxic' },
      { caseId: 'e01-a', arm: 'C', style: 'cool' },
      { caseId: 'e02-b', arm: 'A', style: null },
      { caseId: 'e02-b', arm: 'C', style: 'cool' },
    ])
  })

  it('C 对 B 按说话方式逐个比，C 对 A 只比温柔；没有 C 就不比', () => {
    const pairs = planComparisons(cases, ['A', 'B', 'C'], stylesOf)
    expect(pairs.map((pair) => `${pair.caseId}:${pair.left.arm}/${pair.left.style}-${pair.right.arm}/${pair.right.style}`)).toEqual([
      'e01-a:C/gentle-A/null',
      'e01-a:C/gentle-B/gentle',
      'e01-a:C/toxic-B/toxic',
      'e01-a:C/cool-B/cool',
      'e02-b:C/cool-B/cool',
    ])
    expect(planComparisons(cases, ['A', 'B'], stylesOf)).toEqual([])
  })
})
