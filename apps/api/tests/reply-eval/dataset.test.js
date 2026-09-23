import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { CATEGORIES, loadDataset, validateRubric, validateScenarios } from '../../src/eval/dataset.js'

// 回复质量评测的数据本身：格式、引用与危机分级都要对得上。冻结后改期望要产品负责人确认。
const { rubric, scenarios } = loadDataset(fileURLToPath(new URL('.', import.meta.url)))

describe('回复质量评测数据集', () => {
  it('评分标准没有问题', () => {
    expect(validateRubric(rubric)).toEqual([])
  })

  it('场景集没有问题，六类场景都在', () => {
    expect(validateScenarios(scenarios, rubric)).toEqual([])
    const categories = new Set(scenarios.cases.map((item) => item.category))
    expect([...categories].sort()).toEqual(Object.keys(CATEGORIES).sort())
  })

  it('每条评分条目至少有一个场景在检验它', () => {
    const used = new Set(scenarios.cases.flatMap((item) => item.rubric))
    expect(rubric.items.map((item) => item.id).filter((id) => !used.has(id))).toEqual([])
  })
})
