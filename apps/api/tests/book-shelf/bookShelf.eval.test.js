import { describe, expect, it } from 'vitest'
import {
  loadBookShelfCases, loadQueryVectors, loadUserBookVectors, predictCards, predictUserPassage, promptBudget,
  scoreUserBook, standInBook, standInShelf, userBookCases, validateBookShelfCases,
} from '../../src/eval/bookShelfEval.js'
import { providerHashOf, shelfIndex } from '../../src/services/bookShelf.js'

// 书架选章检验集（路线图 C21 第二步）：不调模型、不联网，进 CI。
// 数字报告用 pnpm --filter cyber-sister-server eval:books；这里只守住底线。
const set = loadBookShelfCases()
const index = shelfIndex()
const vectors = loadQueryVectors()
const withVectors = Boolean(index && vectors && vectors.identity.providerHash === providerHashOf(index)
  && vectors.identity.model === index.model && vectors.identity.dimensions === index.dimensions)
const standIn = standInBook()
const userFixture = loadUserBookVectors(standIn.passages)
const withUserBook = Boolean(vectors && userFixture && userFixture.identity.providerHash === vectors.identity.providerHash
  && userFixture.identity.model === vectors.identity.model)

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

  it.skipIf(!withUserBook)('她的书（拿《情绪急救》改编章节冒充）：当前阈值下不该翻书的一句不翻，翻到的都是对应的章', () => {
    const shelf = standInShelf(standIn, userFixture)
    const score = scoreUserBook(userBookCases(set.cases), (item) => predictUserPassage(item, { vectors, shelf, chapterKeys: standIn.chapterKeys }))
    expect(score.negatives).toBeGreaterThan(0)
    expect(score.falsePositives).toBe(0)
    expect(score.wrong).toBe(0)
  })

  it('翻到书时这一轮多出来的字数守住预算：不该翻书的句子一个字不加，最多不超过 3,500 字', () => {
    expect(promptBudget(set.cases.filter(({ kind }) => kind === 'negative')).withBooks).toBe(0)
    const budget = promptBudget(set.cases, withVectors ? { vectors, index } : {})
    expect(budget.withBooks).toBeGreaterThan(0)
    expect(budget.max).toBeLessThanOrEqual(3500)
  })
})
