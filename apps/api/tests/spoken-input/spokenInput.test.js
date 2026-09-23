/**
 * 口语检验集（见 docs/04-开发/语音输入评测.md）：同一句话打出来和说出来（语音转写的样子），
 * 倾诉识别与危机检测要判得一样。不联网、不花钱，进 CI。
 * 场景与期望在 spoken.cases.json：冻结后改期望要产品负责人确认，不在实现里默默改。
 * knownGap 是登记在案、这一轮不修的缺口，用 it.fails 断言它「还没修」：哪天修好了这里会变红，提醒把登记摘掉。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { judge } from './asrMetrics.js'

const suite = JSON.parse(readFileSync(new URL('./spoken.cases.json', import.meta.url), 'utf8'))
const scenarios = JSON.parse(readFileSync(new URL('../reply-eval/scenarios.json', import.meta.url), 'utf8'))
const KINDS = new Set(['itn', 'filler', 'punct', 'homophone'])

describe('口语检验集的数据', () => {
  it('格式对：id 不重复、期望合法、说法类型只用约定的四种', () => {
    expect(['draft', 'frozen']).toContain(suite.status)
    if (suite.status === 'frozen') expect(suite.frozenAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const ids = suite.cases.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const item of suite.cases) {
      expect(item.typed.trim()).not.toBe('')
      expect([true, false, null]).toContain(item.expect.feeling)
      expect([null, 'medium', 'high']).toContain(item.expect.crisis)
      // 会被整轮拦下的句子不看倾诉判定，其余都要写明
      expect(item.expect.feeling === null).toBe(item.expect.crisis === 'high')
      expect(item.spoken.length).toBeGreaterThan(0)
      for (const variant of item.spoken) {
        expect(variant.kinds.length).toBeGreaterThan(0)
        for (const kind of variant.kinds) expect(KINDS.has(kind)).toBe(true)
        expect(variant.text).not.toBe(item.typed)
      }
    }
  })

  it('引用回复质量评测的句子与场景原文一字不差', () => {
    const texts = new Map(scenarios.cases.map((item) => [item.id, item.text]))
    for (const item of suite.cases.filter((entry) => entry.from === 'reply-eval')) {
      expect(item.typed).toBe(texts.get(item.id))
    }
  })

  it('录音脚本里的危机句只由作者本人录', () => {
    for (const item of suite.cases.filter((entry) => entry.record && entry.expect.crisis)) {
      expect(item.recordBy).toBe('author')
    }
  })
})

describe('说出来和打出来判得一样', () => {
  for (const item of suite.cases) {
    const utterances = [
      { label: '打字', text: item.typed, knownGap: item.knownGap },
      ...item.spoken.map((variant) => ({ label: variant.kinds.join('+'), text: variant.text, knownGap: item.knownGap ?? variant.knownGap })),
    ]
    for (const utterance of utterances) {
      const test = utterance.knownGap ? it.fails : it
      test(`${item.id}（${utterance.label}）「${utterance.text}」${utterance.knownGap ? `——已知缺口：${utterance.knownGap}` : ''}`, () => {
        const got = judge(utterance.text)
        expect(got.crisis).toBe(item.expect.crisis)
        if (item.expect.feeling !== null) expect(got.feeling).toBe(item.expect.feeling)
      })
    }
  }
})
