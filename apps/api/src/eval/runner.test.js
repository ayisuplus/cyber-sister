import { describe, expect, it } from 'vitest'
import { mapPool, runEvaluation } from './runner.js'

const rubric = {
  styles: { gentle: '温柔', toxic: '直爽', cool: '安静' },
  items: [
    { id: 'R1', name: '先接住情绪', layer: 'female', question: '有没有先接住她？' },
    { id: 'R9', name: '说话方式', layer: 'style', question: '符不符合 {style}？' },
  ],
}
const cases = [{
  id: 'e01-tired',
  category: 'emotion',
  text: '好累',
  personas: ['gentle'],
  rubric: ['R1', 'R9'],
  pair: { better: '【好】辛苦了', common: '【差】给你五条建议', commonFails: ['R1'] },
}]

// 假的打分模型：带「【好】」的那条算做到了；两两比较挑带「【好】」的那条
function fakeJudge({ user }) {
  if (user.includes('【回复一】')) {
    const first = user.split('【回复一】')[1].split('【回复二】')[0]
    return Promise.resolve(JSON.stringify({ winner: first.includes('【好】') ? '1' : '2' }))
  }
  const reply = user.split('【要评的回复】')[1].split('【逐条判断】')[0]
  const ids = [...user.matchAll(/^(R\d+)：/gm)].map((match) => match[1])
  const verdict = reply.includes('【好】') ? 'yes' : 'no'
  return Promise.resolve(JSON.stringify(Object.fromEntries(ids.map((id) => [id, { verdict, reason: '假' }]))))
}

describe('评测编排', () => {
  it('并发池保序，且不超过上限', async () => {
    let running = 0
    let peak = 0
    const results = await mapPool([30, 10, 20, 5], 2, async (delay, index) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, delay))
      running -= 1
      return index
    })
    expect(results).toEqual([0, 1, 2, 3])
    expect(peak).toBe(2)
  })

  it('按组生成、盲评打分、C 与其余组比较，并用手写的一对回复自检打分模型', async () => {
    const generated = []
    const run = await runEvaluation({
      rubric,
      cases,
      arms: ['A', 'B', 'C'],
      generate: ({ arm, armConfig, style }) => {
        generated.push(`${arm}/${style}/${armConfig.label}`)
        return Promise.resolve({ reply: arm === 'C' ? '【好】我在' : '【差】先列个计划', source: 'qwen' })
      },
      judge: fakeJudge,
      concurrency: 3,
    })

    expect(generated).toEqual(['A/null/通用模型', 'B/gentle/去掉女性层', 'C/gentle/完整 Amie'])
    const byArm = Object.fromEntries(run.judgements.map((item) => [item.arm, item.verdicts]))
    expect(Object.keys(byArm.A)).toEqual(['R1'])
    expect(byArm.C).toEqual({ R1: { pass: true, reason: '假' }, R9: { pass: true, reason: '假' } })
    expect(run.comparisons.map((item) => `${item.left.arm}-${item.right.arm}:${item.outcome}`)).toEqual(['C-A:left', 'C-B:left'])
    expect(run.validation.pairwise).toEqual([{ caseId: 'e01-tired', outcome: 'better' }])
    expect(run.validation.rubric.find((item) => item.which === 'common').verdicts.R1.pass).toBe(false)
  })

  it('生成失败或打分出错都如实记下，不中断整次评测', async () => {
    const run = await runEvaluation({
      rubric,
      cases,
      arms: ['B', 'C'],
      generate: ({ arm }) => (arm === 'B' ? Promise.reject(new Error('上游 503')) : Promise.resolve({ reply: '【好】我在' })),
      judge: () => Promise.reject(new Error('打分超时')),
    })
    expect(run.generations[0]).toMatchObject({ arm: 'B', reply: null, error: '上游 503' })
    expect(run.judgements).toEqual([expect.objectContaining({ arm: 'C', error: '打分超时' })])
    expect(run.comparisons[0].outcome).toBe('error')
    expect(run.validation.pairwise[0]).toMatchObject({ outcome: 'error', error: '打分超时' })
  })
})
