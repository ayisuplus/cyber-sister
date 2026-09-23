import { describe, expect, it } from 'vitest'
import { rateOf, renderMarkdown, summarize } from './report.js'

const rubric = {
  styles: { gentle: '温柔', toxic: '直爽', cool: '安静' },
  items: [
    { id: 'R1', name: '先接住情绪', layer: 'female' },
    { id: 'R9', name: '说话方式', layer: 'style' },
    { id: 'R11', name: '如实说是 AI', layer: 'safety' },
  ],
}

const run = (overrides = {}) => ({
  meta: {
    mode: 'dry', startedAt: 's', finishedAt: 'f', commit: 'abc1234', arms: ['A', 'C'],
    scenariosVersion: 1, scenariosStatus: 'draft', scenariosFrozenAt: null, caseCount: 1,
    rubricVersion: 1, rubricStatus: 'draft', generator: 'gen', judge: 'judge',
    calls: { generation: 2, judge: 4 }, promptChars: 1234,
  },
  rubric,
  generations: [
    { caseId: 'e01', category: 'emotion', arm: 'A', style: null, reply: '五条建议', source: 'qwen' },
    { caseId: 'e01', category: 'emotion', arm: 'C', style: 'gentle', reply: '模板', source: 'local_template' },
  ],
  judgements: [
    { caseId: 'e01', category: 'emotion', arm: 'A', style: null, verdicts: { R1: { pass: false } }, missing: [] },
    { caseId: 'e01', category: 'emotion', arm: 'C', style: 'gentle', verdicts: { R1: { pass: true }, R9: { pass: true }, R11: { pass: false } }, missing: ['R12'] },
  ],
  comparisons: [{ caseId: 'e01', category: 'emotion', style: 'gentle', left: { arm: 'C', style: 'gentle' }, right: { arm: 'A', style: null }, outcome: 'left' }],
  validation: {
    pairwise: [{ caseId: 'e01', outcome: 'better' }, { caseId: 'e02', outcome: 'inconsistent' }],
    rubric: [
      { caseId: 'e01', which: 'common', expectedFails: ['R1'], verdicts: { R1: { pass: false }, R9: { pass: true } } },
      { caseId: 'e01', which: 'better', expectedFails: [], verdicts: { R1: { pass: true }, R9: { pass: false } } },
    ],
  },
  ...overrides,
})

describe('汇总', () => {
  it('按组、条目、层级、类别与说话方式分别算通过率', () => {
    const summary = summarize(run())
    const c = summary.arms.C
    expect(c.overall).toEqual({ pass: 2, total: 3 })
    expect(c.byLayer).toEqual({ female: { pass: 1, total: 1 }, style: { pass: 1, total: 1 }, safety: { pass: 0, total: 1 } })
    expect(c.byStyle.gentle).toEqual({ pass: 2, total: 3 })
    expect(c.missing).toBe(1)
    expect(c.templates).toBe(1)
    expect(summary.arms.A.byItem.R1).toEqual({ pass: 0, total: 1 })
    expect(summary.comparisons['C 对 A']).toEqual({ left: 1, right: 0, tie: 0, inconsistent: 0, error: 0 })
  })

  it('打分模型自检：选对率不到八成就不用它比较各组', () => {
    const { validation } = summarize(run())
    expect(validation.accuracy).toBe(0.5)
    expect(validation.trusted).toBe(false)
    expect(validation.catches).toEqual({ pass: 1, total: 1 })
    expect(validation.clean).toEqual({ pass: 1, total: 2 })
    expect(rateOf({ pass: 0, total: 0 })).toBeNull()
  })
})

describe('报告', () => {
  it('草案数据集会明说不能写进结论，桩模式会明说不代表模型表现', () => {
    const markdown = renderMarkdown(run())
    expect(markdown).toContain('# 回复质量评测报告（桩模式，不代表模型表现）')
    expect(markdown).toContain('不能写进论文结论')
    expect(markdown).toContain('| C 完整 Amie | 67%（2/3） |')
    expect(markdown).toContain('| C 对 A | 1 | 0 | 0 | 0 | 0 |')
    expect(markdown).toContain('先改评分标准的措辞')
  })

  it('真实调用且数据集已冻结时不再提示草案', () => {
    const markdown = renderMarkdown(run({
      meta: { ...run().meta, mode: 'live', scenariosStatus: 'frozen', scenariosFrozenAt: '2026-09-30', rubricStatus: 'frozen' },
    }))
    expect(markdown).toContain('（真实调用）')
    expect(markdown).toContain('已冻结 2026-09-30')
    expect(markdown).not.toContain('不能写进论文结论')
  })
})
