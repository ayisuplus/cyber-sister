import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { listSkillFiles, readSkillCard } from './skillCatalog.js'
import { cosineSimilarity } from './embeddingConfig.js'
import logger from '../utils/logger.js'

/**
 * 书架：由书改编的章节卡怎么读进来、一句话该翻哪几章。
 *
 * 章节卡是 skills/<书>/chapters/*.md，文首写 title / origin / use / priority / keywords；
 * 书名、作者、版本、没采纳的部分与边界写在这本书 SKILL.md 的文首。加一本书只放卡片，不改这里。
 * 各书自己的规则（拒绝分析、点名要理论、短追问怎么认、怎么拼 system 块）留在各书模块。
 *
 * 选章先看关键词；有书架索引（skills/book-index.json，scripts/index-book-cards.mjs 建）、
 * 这一轮又已经为找记忆算过这句话的向量时，关键词没认出的书再用向量补一章。不为找书多调一次云端。
 */

/** 一轮最多翻几章：所有书放在一起排，书再多，提示词也不跟着涨。 */
export const MAX_BOOK_CARDS = 2

export const BOOK_INDEX_PATH = fileURLToPath(new URL('../skills/book-index.json', import.meta.url))

const sha256 = (text) => createHash('sha256').update(String(text)).digest('hex')

/** 拿去算向量的那段文字：章名、用途和正文。索引按它的哈希核对卡片改没改过。 */
export const cardEmbeddingText = (card) => `${card.title}\n${card.use}\n${card.content}`

/** 向量供应商地址不进仓库，只记它的哈希；核对身份时两边都比哈希。 */
export const providerHashOf = (identity) => identity?.providerHash ?? (identity?.provider ? sha256(identity.provider).slice(0, 16) : null)

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
  const card = { id, key: `${bookName}/${id}`, book: bookName, title: fields.title, origin: fields.origin, use: fields.use, priority, keywords, content: body }
  return { ...card, hash: sha256(cardEmbeddingText(card)) }
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

/** 把索引文件整理成查表用的样子；格式不对返回 null（只用关键词）。 */
export function parseBookIndex(raw) {
  if (!raw || !Array.isArray(raw.cards) || !Number.isInteger(raw.dimensions) || !(raw.minScore > 0 && raw.minScore < 1)) return null
  const vectors = new Map()
  for (const { key, hash, vector } of raw.cards) {
    if (typeof key === 'string' && typeof hash === 'string' && Array.isArray(vector) && vector.length === raw.dimensions) vectors.set(key, { hash, vector })
  }
  return { providerHash: raw.providerHash, model: raw.model, dimensions: raw.dimensions, ruleVersion: raw.ruleVersion, minScore: raw.minScore, vectors }
}

let loadedIndex
/** 仓库里的书架索引，读一次；没有或读不出就只用关键词。 */
export function shelfIndex() {
  if (loadedIndex !== undefined) return loadedIndex
  try {
    loadedIndex = parseBookIndex(JSON.parse(readFileSync(BOOK_INDEX_PATH, 'utf8')))
    if (!loadedIndex) logger.warn('书架索引格式不对，选章只用关键词')
  } catch (error) {
    if (error?.code !== 'ENOENT') logger.warn('书架索引读不出，选章只用关键词', { code: error?.code || 'PARSE_FAILED' })
    loadedIndex = null
  }
  return loadedIndex
}

/** 这句话的向量能不能拿来和索引比：供应商、模型、维度、规则版本都对得上才行。 */
function comparableQuery(query, index) {
  if (!index || !Array.isArray(query?.vector) || query.vector.length !== index.dimensions) return null
  const same = providerHashOf(query) === index.providerHash && query.model === index.model
    && query.dimensions === index.dimensions && query.ruleVersion === index.ruleVersion
  return same ? query.vector : null
}

const matching = (book, text) => book.cards.filter((card) => card.keywords.test(text))

/** 意思挨得近的章（按相似度从高到低）；卡片改过、索引没重建的不算。 */
function closeCards(book, vector, index) {
  return book.cards
    .map((card) => {
      const entry = index.vectors.get(card.key)
      return { card, score: entry?.hash === card.hash ? cosineSimilarity(vector, entry.vector) : 0 }
    })
    .filter(({ score }) => score >= index.minScore)
    .sort((a, b) => b.score - a.score)
    .map(({ card }) => card)
}

/**
 * 这一本书命中的章：先按关键词（按优先级）；关键词一章都没认出时，才用向量补最挨得近的那一章。
 * 同一本书的几章彼此也像（妇科几章尤其），关键词已经认准了还往里补，多出来的多半是翻错。
 * 她说了不要分析，整本不翻，返回 null。
 */
function hitsFor(book, { text, history, vector, index }) {
  if (book.declined?.(text)) return null
  const hits = matching(book, text)
  if (!hits.length && book.followUp?.test(text.trim())) {
    // 只有明确的短追问才接着上一句她说的；助手的推测和更早的话题不算。「那怎么办」本身的向量没有意思，不拿来比
    const lastUser = history.slice().reverse().find((message) => message?.role === 'user')
    return typeof lastUser?.content === 'string' && !book.declined?.(lastUser.content) ? matching(book, lastUser.content) : hits
  }
  return hits.length || !vector ? hits : closeCards(book, vector, index).slice(0, 1)
}

/**
 * 在这些书里挑这一轮要翻的章：各书轮流出自己最靠前的一章，全局最多 MAX_BOOK_CARDS 章。
 * queryEmbedding 是这一轮为找记忆已经算好的向量（没同意云端模型或没配向量时为 null，只看关键词）。
 * 返回 [{ book, cards }]，顺序与 books 一致；没翻到章、但被点名要这本书时 cards 为空。
 */
export function selectCards(books, { text, history = [], scene = 'chat', queryEmbedding = null, index = shelfIndex() } = {}) {
  if (scene !== 'chat' || typeof text !== 'string') return []
  const vector = comparableQuery(queryEmbedding, index)
  const perBook = books.map((book) => ({ book, hits: hitsFor(book, { text, history, vector, index }) }))
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
