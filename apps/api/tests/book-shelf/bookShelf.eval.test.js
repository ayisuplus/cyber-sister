import { describe, expect, it } from 'vitest'
import { loadBookShelfCases, loadQueryVectors, predictCards, validateBookShelfCases } from '../../src/eval/bookShelfEval.js'
import { providerHashOf, shelfIndex } from '../../src/services/bookShelf.js'

// 书架选章检验集（路线图 C21 第二步）：不调模型、不联网，进 CI。
// 数字报告用 pnpm --filter cyber-sister-server eval:books；这里只守住底线。
const set = loadBookShelfCases()
const index = shelfIndex()
const vectors = loadQueryVectors()
const withVectors = Boolean(index && vectors && vectors.identity.providerHash === providerHashOf(index)
  && vectors.identity.model === index.model && vectors.identity.dimensions === index.dimensions)

describe('书架选章检验集', () => {
  it('格式对，期望的章都在书架上', () => {
    expect(validateBookShelfCases(set)).toEqual([])
  })

  it('只用关键词：评测里会带书的 10 个场景都翻对，不该翻书的一章不翻', () => {
    for (const item of set.cases.filter(({ kind }) => kind === 'keyword' || kind === 'negative')) {
      expect(predictCards(item), item.id).toEqual(item.expect)
    }
  })

  it.skipIf(!withVectors)('加上向量：评测原句照旧翻对，不该翻书的仍一章不翻', () => {
    for (const item of set.cases.filter(({ kind }) => kind === 'keyword' || kind === 'negative')) {
      expect(predictCards(item, { vectors, index }), item.id).toEqual(item.expect)
    }
  })
})
