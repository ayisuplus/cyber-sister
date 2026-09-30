import { describe, expect, it } from 'vitest'
import { charErrorRate, editDistance, normalizeForCer, renderReport, scoreRows } from './asrMetrics.js'

const suite = {
  version: 'v1',
  status: 'draft',
  cases: [
    { id: 'e01', typed: '睡不着，明早九点要跟全组汇报', expect: { feeling: true, crisis: null } },
    { id: 'c01', typed: '活着好累，每天都不知道是为了什么', expect: { feeling: true, crisis: 'medium' } },
  ],
}

describe('字错率', () => {
  it('去掉标点、空格和表情，汉字数字与阿拉伯数字算同一个', () => {
    expect(normalizeForCer('明早九点，要汇报！😔')).toBe('明早9点要汇报')
    expect(normalizeForCer('十一点半 过 PPT')).toBe('11点半过ppt')
    expect(normalizeForCer('二十三点')).toBe('23点')
    // 不是数的连写原样保留
    expect(normalizeForCer('一一道来')).toBe('一一道来')
    expect(charErrorRate('睡不着，明早九点要跟全组汇报', '睡不着明早9点要跟全组汇报。')).toBe(0)
  })

  it('替换、删除、插入各算一个错字；什么都没转出来就是全错', () => {
    expect(editDistance('不想活了', '不像活了')).toBe(1)
    expect(editDistance('好累', '好好累呀')).toBe(2)
    expect(charErrorRate('我真的不想活了', '我真的不像活了')).toBeCloseTo(1 / 7)
    expect(charErrorRate('好累', '')).toBe(1)
  })
})

const rows = [
  // 转写丢掉整段危机表达，验证评测器仍能报告真正的漏检；口头语变体现在已能识别。
  { file: 'P1_whisper_c01.wav', speaker: 'P1', condition: 'whisper', caseId: 'c01', text: '每天都不知道是为了什么。', emotions: ['HAPPY'], events: ['Speech'] },
  { file: 'P1_normal_e01.wav', speaker: 'P1', condition: 'normal', caseId: 'e01', text: '睡不着，明早9点要跟全组汇报。', emotions: ['SAD'], events: ['Speech'] },
  { file: 'P2_soft_e01.wav', speaker: 'P2', condition: 'soft', caseId: 'e01', text: '', emotions: [], events: ['Event_UNK'] },
  { file: 'zh.mp3', speaker: null, condition: null, caseId: null, text: '开放时间早上9点至下午5点。', emotions: ['NEUTRAL'], events: ['Speech'] },
]

describe('逐条打分', () => {
  it('和打字原句比：危机句没认出、倾诉判定变了、情绪标签和内容不符都记下来；不合命名规则的不计入', () => {
    const [c01, e01, empty, loose] = scoreRows(rows, suite)
    expect(c01).toMatchObject({ scored: true, typedCrisis: 'medium', gotCrisis: null, crisisSame: false, happyTagged: true })
    expect(e01).toMatchObject({ scored: true, cer: 0, crisisSame: true, feelingSame: true, happyTagged: false })
    expect(empty).toMatchObject({ scored: true, cer: 1, empty: true, feelingSame: false })
    expect(loose.scored).toBe(false)
  })
})

describe('报告', () => {
  it('按条件、按说话人列指标，危机句没认出来的逐条列出', () => {
    const report = renderReport('asr-test', rows, suite)
    expect(report).toContain('转写 4 条，计入指标 3 条')
    expect(report).toContain('草稿，未冻结')
    expect(report).toContain('| 气声 | 1 |')
    expect(report).toContain('| P2 | 1 |')
    expect(report).toMatch(/## 危机句没认出来的[\s\S]*每天都不知道是为了什么/)
    expect(report).toContain('## 错得最多的 10 句')
  })
})
