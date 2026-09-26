import { describe, expect, it } from 'vitest'
import {
  loadMemoryCases, loadMemoryVectors, memoriesWithVectors, noiseFromVectors, predictMemories, scoreMemoryRetrieval, validateMemoryCases,
} from '../../src/eval/memoryRetrievalEval.js'
import { textHashOf } from '../../src/eval/bookShelfEval.js'

// 记忆检索检验集（路线图 C23 第四步）：不调模型、不联网，进 CI。
// 数字报告用 pnpm --filter cyber-sister-server eval:memories；这里只守住底线。
const set = loadMemoryCases()
const vectors = loadMemoryVectors()
const plain = memoriesWithVectors(set)
const keywordOnly = scoreMemoryRetrieval(set.cases, (item) => predictMemories(item, plain))
const ofKinds = (score, kinds) => ({ ...score, details: score.details.filter((row) => kinds.includes(row.kind)) })

describe('记忆检索检验集', () => {
  it('格式对，引用的记忆都在', () => {
    expect(validateMemoryCases(set)).toEqual([])
  })

  it('只用关键词与标签：字面对得上的句子，该带的都带了', () => {
    expect(keywordOnly.byKind.literal.recall).toBe(1)
  })

  it.skipIf(!vectors)('向量夹具与检验集对得上：改了哪条的文字，就要重跑 memories:fixture -- --live', () => {
    for (const memory of set.memories) expect(vectors.memories.get(memory.id)?.textHash, memory.id).toBe(textHashOf(memory.content))
    for (const item of set.cases) expect(vectors.queries.get(item.id)?.textHash, item.id).toBe(textHashOf(item.text))
  })

  it.skipIf(!vectors)('现行阈值下：不该带记忆、字面撞车、字面对得上的句子，向量一条无关记忆也不多带；字面的照旧全找到', () => {
    const memories = memoriesWithVectors(set, vectors)
    const score = scoreMemoryRetrieval(set.cases, (item) => predictMemories(item, memories, { vectors }))
    const guarded = ['negative', 'trap', 'literal']
    expect(noiseFromVectors(ofKinds(score, guarded), ofKinds(keywordOnly, guarded))).toBe(0)
    expect(score.byKind.literal.recall).toBe(1)
    // 向量的用处：她换个说法、随口一句，关键词一条都找不回来，加上向量至少找回一半
    const { paraphrase, spoken } = score.byKind
    expect((paraphrase.hits + spoken.hits) / (paraphrase.expected + spoken.expected)).toBeGreaterThan(0.5)
  })

  it.skipIf(!vectors)('关键词撞车请向量作证（2026-09-26 裁定）：多带的无关记忆少一半以上，召回一条不掉；「喜欢」撞车的两句一条不带', () => {
    const memories = memoriesWithVectors(set, vectors)
    const on = scoreMemoryRetrieval(set.cases, (item) => predictMemories(item, memories, { vectors }))
    const off = scoreMemoryRetrieval(set.cases, (item) => predictMemories(item, memories, { vectors, corroborate: false }))
    expect(on.overall.hits).toBe(off.overall.hits)
    expect(on.overall.noise * 2).toBeLessThan(off.overall.noise)
    for (const id of ['t02-what-do-you-like', 't05-like-you']) expect(on.details.find((row) => row.id === id).got, id).toEqual([])
  })
})
