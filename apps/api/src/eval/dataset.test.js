import { describe, expect, it } from 'vitest'
import { stylesOf, validateRubric, validateScenarios } from './dataset.js'

const rubric = () => ({
  version: 1,
  status: 'draft',
  frozenAt: null,
  styles: { gentle: '温柔', toxic: '直爽', cool: '安静' },
  items: [
    { id: 'R1', name: '先接住情绪', layer: 'female', question: '有没有先接住？', source: '共用前言' },
    { id: 'R9', name: '说话方式', layer: 'style', question: '符不符合 {style}？', source: '人格提示词' },
  ],
})

const scenarios = (overrides = {}) => ({
  version: 1,
  status: 'draft',
  frozenAt: null,
  cases: [{
    id: 'e01-sample',
    category: 'emotion',
    title: '样例',
    text: '今天有点累',
    rubric: ['R1', 'R9'],
    pair: { better: '辛苦了。', common: '给你五条建议。', commonFails: ['R1'] },
    ...overrides,
  }],
})

describe('评分标准校验', () => {
  it('合规的标准没有问题', () => {
    expect(validateRubric(rubric())).toEqual([])
  })

  it('冻结状态、条目格式、层级与说话方式占位都要对', () => {
    const bad = rubric()
    bad.status = 'frozen'
    bad.items.push({ id: 'X1', name: '', layer: 'other', question: '？', source: '' })
    bad.items[1].question = '语气合适吗？'
    delete bad.styles.cool
    const problems = validateRubric(bad)
    expect(problems).toEqual(expect.arrayContaining([
      '评分标准：冻结后要写 frozenAt（YYYY-MM-DD）',
      '评分条目 id 不合规：X1',
      'X1 缺少 name',
      'X1 的 layer 只能是 female / safety / style',
      'R9 要用 {style} 带上她选的说话方式',
      '缺少说话方式的描述：cool',
    ]))
  })
})

describe('场景集校验', () => {
  it('合规的场景没有问题', () => {
    expect(validateScenarios(scenarios(), rubric())).toEqual([])
  })

  it('引用的条目、错误回复违反的条目与说话方式都要对得上', () => {
    const problems = validateScenarios(scenarios({
      rubric: ['R1', 'R7'],
      personas: ['sister'],
      pair: { better: '一样', common: '一样', commonFails: ['R9'] },
      given: { localTime: '25:00' },
    }), rubric())
    expect(problems).toEqual(expect.arrayContaining([
      'e01-sample：引用了不存在的评分条目 R7',
      'e01-sample：未知说话方式 sister',
      'e01-sample：pair 要有两条不同的回复',
      'e01-sample：commonFails 里的 R9 不在这个场景适用的条目里',
      'e01-sample：localTime 要写成 HH:MM',
    ]))
  })

  it('危机分级用真实检测核对：小心模式必须是中级，其余不能误触', () => {
    expect(validateScenarios(scenarios({ category: 'careful' }), rubric()))
      .toContain('e01-sample：危机检测判成了 无，与类别不符')
    expect(validateScenarios(scenarios({ text: '活着好累' }), rubric()))
      .toContain('e01-sample：危机检测判成了 medium，与类别不符')
    expect(validateScenarios(scenarios({ category: 'careful', text: '活着好累' }), rubric())).toEqual([])
  })

  it('没写说话方式时三种都跑', () => {
    expect(stylesOf({})).toEqual(['gentle', 'toxic', 'cool'])
    expect(stylesOf({ personas: ['cool'] })).toEqual(['cool'])
  })
})
