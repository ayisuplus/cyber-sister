import { listSkillFiles, readSkillCard } from './skillCatalog.js'
import logger from '../utils/logger.js'

/**
 * 书架：由书改编的章节卡怎么读进来、一句话该翻哪几章。
 *
 * 章节卡是 skills/<书>/chapters/*.md，文首写 title / origin / use / priority / keywords；
 * 书名、作者、版本、没采纳的部分与边界写在这本书 SKILL.md 的文首。加一本书只放卡片，不改这里。
 * 各书自己的规则（拒绝分析、点名要理论、短追问怎么认、怎么拼 system 块）留在各书模块。
 */

/** 一轮最多翻几章：所有书放在一起排，书再多，提示词也不跟着涨。 */
export const MAX_BOOK_CARDS = 2

function toCard(bookName, file) {
  const { fields, body } = readSkillCard(bookName, file)
  const priority = Number(fields.priority)
  if (!fields.title || !fields.origin || !fields.use || !fields.keywords || !Number.isFinite(priority)) {
    logger.warn('章节卡缺少文首元数据，已跳过', { book: bookName, file })
    return null
  }
  let keywords
  try {
    keywords = new RegExp(fields.keywords, 'i')
  } catch {
    logger.warn('章节卡关键词不是合法正则，已跳过', { book: bookName, file })
    return null
  }
  const id = file.replace(/^chapters\//, '').replace(/\.md$/, '')
  return { id, book: bookName, title: fields.title, origin: fields.origin, use: fields.use, priority, keywords, content: body }
}

/**
 * 读入一本书：书目信息 + 按优先级排好的章节卡，再并上这本书自己的规则。
 * rules: { render(cards, text) 必填；declined(text)、followUp、triggered(text) 可选 }
 */
export function loadBook(name, rules) {
  const { fields } = readSkillCard(name)
  const cards = listSkillFiles(name, 'chapters').map((file) => toCard(name, file)).filter(Boolean)
  cards.sort((a, b) => a.priority - b.priority)
  return {
    name,
    meta: { title: fields.book, author: fields.author, edition: fields.edition, setAside: fields['set-aside'], boundary: fields.boundary },
    cards,
    ...rules,
  }
}

const matching = (book, text) => book.cards.filter((card) => card.keywords.test(text))

/** 这一本书命中的章（按优先级）；她说了不要分析，整本不翻，返回 null。 */
function hitsFor(book, text, history) {
  if (book.declined?.(text)) return null
  const hits = matching(book, text)
  if (hits.length || !book.followUp?.test(text.trim())) return hits
  // 只有明确的短追问才接着上一句她说的；助手的推测和更早的话题不算
  const lastUser = history.slice().reverse().find((message) => message?.role === 'user')
  if (typeof lastUser?.content !== 'string' || book.declined?.(lastUser.content)) return hits
  return matching(book, lastUser.content)
}

/**
 * 在这些书里挑这一轮要翻的章：各书轮流出自己最靠前的一章，全局最多 MAX_BOOK_CARDS 章。
 * 返回 [{ book, cards }]，顺序与 books 一致；没翻到章、但被点名要这本书时 cards 为空。
 */
export function selectCards(books, { text, history = [], scene = 'chat' } = {}) {
  if (scene !== 'chat' || typeof text !== 'string') return []
  const perBook = books.map((book) => ({ book, hits: hitsFor(book, text, history) }))
  const chosen = new Set()
  for (let round = 0; chosen.size < MAX_BOOK_CARDS; round += 1) {
    const next = perBook.map(({ hits }) => hits?.[round]).filter(Boolean)
    if (!next.length) break
    for (const card of next) if (chosen.size < MAX_BOOK_CARDS) chosen.add(card)
  }
  return perBook.flatMap(({ book, hits }) => {
    if (!hits) return []
    const cards = hits.filter((card) => chosen.has(card))
    return cards.length || book.triggered?.(text) ? [{ book, cards }] : []
  })
}

/** 选好的章写成页边批注：纯数据，随她那一段落库，以后卡片改了也照实留着当时翻的是什么。 */
export function describeSelection(selection = []) {
  return selection.map(({ book, cards }) => ({
    book: book.name,
    ...book.meta,
    chapters: cards.map(({ id, title, origin, use }) => ({ id, title, origin, use })),
  }))
}
