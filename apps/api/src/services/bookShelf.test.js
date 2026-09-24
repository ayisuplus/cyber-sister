import { describe, expect, it } from 'vitest'
import { bodyCareBook } from './bodyCareSkill.js'
import { emotionReflectionBook } from './emotionReflectionSkill.js'
import { MAX_BOOK_CARDS, selectCards } from './bookShelf.js'
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
