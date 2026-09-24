import { describe, expect, it } from 'vitest'
import { bodyCareBook } from './bodyCareSkill.js'
import { emotionReflectionBook } from './emotionReflectionSkill.js'
import { MAX_BOOK_CARDS, parseBookIndex, providerHashOf, selectCards } from './bookShelf.js'
import { listSkillFiles, readSkillResource, skillSection } from './skillCatalog.js'

const BOOKS = [bodyCareBook, emotionReflectionBook]

describe('书架：章节卡', () => {
  it.each(BOOKS.map((book) => [book.name, book]))('%s 的每张章节卡都读全了文首元数据', (name, book) => {
    expect(book.cards.map(({ id }) => `chapters/${id}.md`).sort()).toEqual(listSkillFiles(name, 'chapters'))
    expect(new Set(book.cards.map(({ priority }) => priority)).size).toBe(book.cards.length)
    for (const card of book.cards) {
      expect(card.content.startsWith(`# ${card.title}`)).toBe(true)
    }
  })

  it.each(BOOKS.map((book) => [book.name, book]))('%s 的卡片与 SKILL.md 索引表、方法取舍一致', (name, book) => {
    const index = readSkillResource(name).split(/\r?\n/).filter((line) => line.startsWith('|'))
    for (const card of book.cards) {
      const row = index.find((line) => line.includes(`(chapters/${card.id}.md)`))
      expect(row, card.id).toBeDefined()
      expect(row).toContain(`[${card.title}]`)
      expect(row).toContain(card.origin)
      expect(row).toContain(card.use)
    }
    expect(book.meta.title && book.meta.author && book.meta.edition && book.meta.boundary).toBeTruthy()
    expect(skillSection(name, '方法取舍')).toContain(book.meta.setAside)
  })

  it('模型读到的章节正文不带文首元数据', () => {
    const text = readSkillResource('emotion-reflection', 'chapters/envy.md')
    expect(text.startsWith('# 比较与嫉羡')).toBe(true)
    expect(text).not.toContain('keywords:')
  })
})

describe('书架：选章', () => {
  it(`全局最多 ${MAX_BOOK_CARDS} 章，同一本书按优先级`, () => {
    const selection = selectCards(BOOKS, { text: '月经 白带 避孕 私处 宫颈糜烂 多囊' })
    expect(selection.map(({ book, cards }) => [book.name, cards.map(({ id }) => id)])).toEqual([
      ['body-care', ['ch05-protection', 'ch01-discharge']],
    ])
  })

  it('只有明确的短追问才接着上一句她说的', () => {
    const pick = (text, history) => selectCards(BOOKS, { text, history }).flatMap(({ cards }) => cards.map(({ id }) => id))
    expect(pick('那怎么办？', [{ role: 'user', content: '痛经' }])).toEqual(['ch02-period'])
    expect(pick('继续说', [{ role: 'user', content: '痛经又孤独' }])).toEqual(['ch02-period', 'loneliness'])
    expect(pick('继续说', [{ role: 'user', content: '孤独，但不要分析我' }])).toEqual([])
    expect(pick('那怎么办', [{ role: 'assistant', content: '你嫉妒她' }])).toEqual([])
  })

  it('非聊天场景、不是文字时一章都不翻', () => {
    expect(selectCards(BOOKS, { text: '痛经', scene: 'work' })).toEqual([])
    expect(selectCards(BOOKS, { text: null })).toEqual([])
  })
})

describe('书架：向量补上关键词漏掉的说法', () => {
  const envy = emotionReflectionBook.cards.find(({ id }) => id === 'envy')
  const period = bodyCareBook.cards.find(({ id }) => id === 'ch02-period')
  const IDENTITY = { provider: 'https://embedding.test/v1', model: 'embed-test', dimensions: 3, ruleVersion: 1 }
  const indexWith = (entries, overrides = {}) => parseBookIndex({
    providerHash: providerHashOf(IDENTITY), model: 'embed-test', dimensions: 3, ruleVersion: 1, minScore: 0.8,
    cards: entries, ...overrides,
  })
  const index = indexWith([{ key: envy.key, hash: envy.hash, vector: [1, 0, 0] }, { key: period.key, hash: period.hash, vector: [0, 1, 0] }])
  const query = (vector, identity = IDENTITY) => ({ ...identity, vector })
  const pick = (text, options) => selectCards(BOOKS, { text, index, ...options }).flatMap(({ cards }) => cards.map(({ key }) => key))

  it('关键词认不出、意思挨得近的章也翻到；没有这一轮的向量就只看关键词', () => {
    expect(pick('看她过得那么好，我心里不是滋味', { queryEmbedding: query([1, 0, 0]) })).toEqual(['emotion-reflection/envy'])
    expect(pick('看她过得那么好，我心里不是滋味', { queryEmbedding: null })).toEqual([])
  })

  it('不够近、向量身份对不上、卡片改过没重建索引，都不算', () => {
    expect(pick('看她过得那么好', { queryEmbedding: query([0.5, 0.5, 0.7]) })).toEqual([])
    expect(pick('看她过得那么好', { queryEmbedding: query([1, 0, 0], { ...IDENTITY, model: 'another-model' }) })).toEqual([])
    expect(pick('看她过得那么好', { queryEmbedding: query([1, 0]) })).toEqual([])
    const stale = indexWith([{ key: envy.key, hash: 'stale', vector: [1, 0, 0] }])
    expect(pick('看她过得那么好', { index: stale, queryEmbedding: query([1, 0, 0]) })).toEqual([])
  })

  it('短追问不拿「那怎么办」本身的向量去比；她说了不要分析，向量也不翻', () => {
    expect(pick('那怎么办', { queryEmbedding: query([1, 0, 0]) })).toEqual([])
    expect(pick('心里不是滋味，但不要分析我', { queryEmbedding: query([1, 0, 0]) })).toEqual([])
  })

  it('关键词命中的排在前面；几本书仍然轮流出一章，全局最多两章', () => {
    expect(pick('痛经', { queryEmbedding: query([1, 0, 0]) })).toEqual(['body-care/ch02-period', 'emotion-reflection/envy'])
    expect(pick('月经不规律，白带也多', { queryEmbedding: query([1, 0, 0]) })).toEqual(['body-care/ch01-discharge', 'emotion-reflection/envy'])
  })

  it('索引格式不对就当没有', () => {
    expect(parseBookIndex(null)).toBeNull()
    expect(parseBookIndex({ cards: [], dimensions: 3, minScore: 2 })).toBeNull()
  })
})
