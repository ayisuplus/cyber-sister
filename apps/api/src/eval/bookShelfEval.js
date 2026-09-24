import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BOOKS, buildBookSkillContexts, userBookSearch } from '../services/bookSkills.js'
import { selectCards } from '../services/bookShelf.js'
import { chunkBook, passageEmbeddingText, pickPassage, PASSAGE_MIN_SCORE, toShelfBook } from '../services/bookIndexService.js'

/**
 * 书架选章检验集（路线图 C21 第二步）：一句话该翻哪本书的哪一章，只用关键词和加上向量各对了多少。
 * 不调模型、不联网：句子的向量事先由 scripts/index-book-cards.mjs 算好存成夹具。
 */
export const CASES_PATH = fileURLToPath(new URL('../../tests/book-shelf/cases.json', import.meta.url))
export const QUERY_VECTORS_PATH = fileURLToPath(new URL('../../tests/book-shelf/query-vectors.json', import.meta.url))
export const USER_BOOK_VECTORS_PATH = fileURLToPath(new URL('../../tests/book-shelf/user-book-vectors.json', import.meta.url))
const SCENARIOS_PATH = fileURLToPath(new URL('../../tests/reply-eval/scenarios.json', import.meta.url))

export const KINDS = { keyword: '评测原句', paraphrase: '换个说法', spoken: '说出来的', negative: '不该翻书' }

/** 句子的哈希：夹具里的向量按它核对句子改没改过。 */
export const textHashOf = (text) => createHash('sha256').update(String(text)).digest('hex').slice(0, 16)

/** 读检验集；from 指向回复质量评测的场景，原句从那里取，只存一份。 */
export function loadBookShelfCases(path = CASES_PATH) {
  const set = JSON.parse(readFileSync(path, 'utf8'))
  const scenarios = new Map(JSON.parse(readFileSync(SCENARIOS_PATH, 'utf8')).cases.map((scenario) => [scenario.id, scenario]))
  return { ...set, cases: set.cases.map((item) => ({ ...item, text: item.from ? scenarios.get(item.from)?.text : item.text })) }
}

/** 格式与引用检查：返回问题列表，空数组表示没问题。 */
export function validateBookShelfCases(set, books = BOOKS) {
  const known = new Set(books.flatMap((book) => book.cards.map((card) => card.key)))
  const problems = []
  const seen = new Set()
  for (const item of set.cases ?? []) {
    if (seen.has(item.id)) problems.push(`${item.id}：id 重复`)
    seen.add(item.id)
    if (!KINDS[item.kind]) problems.push(`${item.id}：不认识的类别 ${item.kind}`)
    if (typeof item.text !== 'string' || !item.text.trim()) problems.push(`${item.id}：没有句子${item.from ? `（找不到场景 ${item.from}）` : ''}`)
    if (!Array.isArray(item.expect)) { problems.push(`${item.id}：expect 不是数组`); continue }
    for (const key of item.expect) if (!known.has(key)) problems.push(`${item.id}：书架上没有 ${key}`)
    if ((item.kind === 'negative') !== (item.expect.length === 0)) problems.push(`${item.id}：只有「不该翻书」的期望为空`)
  }
  return problems
}

/** 读句子向量的夹具；没有或格式不对返回 null。 */
export function loadQueryVectors(path = QUERY_VECTORS_PATH) {
  let raw
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
  if (!Array.isArray(raw?.queries)) return null
  const identity = { providerHash: raw.providerHash, model: raw.model, dimensions: raw.dimensions, ruleVersion: raw.ruleVersion }
  return { identity, byId: new Map(raw.queries.map(({ id, textHash, vector }) => [id, { textHash, vector }])) }
}

/** 这一句的查询向量：夹具里有、句子也没改过才给，否则 null（这一句只看关键词）。 */
export function queryEmbeddingFor(item, vectors) {
  const entry = vectors?.byId.get(item.id)
  return entry && entry.textHash === textHashOf(item.text) ? { ...vectors.identity, vector: entry.vector } : null
}

/** 这一句翻到的章（<书>/<章>）。index 为 null 时只看关键词。 */
export function predictCards(item, options = {}) {
  return selectFor(item, options).flatMap(({ cards }) => cards.map((card) => card.key))
}

function selectFor(item, { vectors = null, index = null } = {}) {
  const queryEmbedding = index ? queryEmbeddingFor(item, vectors) : null
  return selectCards(BOOKS, { text: item.text, history: item.history ?? [], queryEmbedding, index })
}

/**
 * 翻到书时这一轮的提示词多出多少字（路线图 C22 的 token 预算）：带书的句数、平均、最多。
 * 按「回答里可以提到书」算，多一行说明，取偏大的那个。
 */
export function promptBudget(cases, options = {}) {
  const sizes = cases
    .map((item) => buildBookSkillContexts(selectFor(item, options), item.text, { citeBooks: true }))
    .filter((blocks) => blocks.length)
    .map((blocks) => blocks.reduce((sum, { content }) => sum + content.length, 0))
  const average = sizes.length ? Math.round(sizes.reduce((sum, size) => sum + size, 0) / sizes.length) : 0
  return { cases: cases.length, withBooks: sizes.length, average, max: Math.max(0, ...sizes) }
}

const ratio = (part, whole) => (whole ? part / whole : null)

/** 精确率、召回率（按章数算），不该翻书却翻了的句数，以及逐句的错漏。 */
export function scoreBookShelf(cases, predict) {
  const tally = () => ({ cases: 0, expected: 0, predicted: 0, correct: 0, exact: 0 })
  const overall = tally()
  const byKind = Object.fromEntries(Object.keys(KINDS).map((kind) => [kind, tally()]))
  const mistakes = []
  for (const item of cases) {
    const predicted = predict(item)
    const correct = predicted.filter((key) => item.expect.includes(key)).length
    const exact = correct === item.expect.length && predicted.length === item.expect.length
    for (const bucket of [overall, byKind[item.kind]]) {
      bucket.cases += 1
      bucket.expected += item.expect.length
      bucket.predicted += predicted.length
      bucket.correct += correct
      bucket.exact += exact ? 1 : 0
    }
    if (!exact) mistakes.push({ id: item.id, kind: item.kind, expect: item.expect, predicted })
  }
  const finish = (bucket) => ({ ...bucket, precision: ratio(bucket.correct, bucket.predicted), recall: ratio(bucket.correct, bucket.expected) })
  return {
    overall: finish(overall),
    byKind: Object.fromEntries(Object.entries(byKind).map(([kind, bucket]) => [kind, finish(bucket)])),
    negativesWithBooks: byKind.negative.predicted ? mistakes.filter((mistake) => mistake.kind === 'negative').length : 0,
    mistakes,
  }
}

// ── 她的书（路线图 C22）：拿《情绪急救》的改编章节冒充一本她上传的书，标定 PASSAGE_MIN_SCORE ──
// 这些是我们自己写的文字，能进仓库；原书全文不进。走和她上传时一样的切段，段落向量存成夹具，CI 离线核对。

const STAND_IN = 'emotional-first-aid'

/** 冒充的那本书：每张章节卡当一章，章名是卡片标题；段落按上传时的规则切。 */
export function standInBook(books = BOOKS) {
  const book = books.find(({ name }) => name === STAND_IN)
  const chapters = book.cards.map((card) => ({ title: card.title, text: card.content }))
  const passages = chunkBook(chapters)
  return { book, chapterKeys: book.cards.map((card) => card.key), passages }
}

/** 读冒充书的段落向量夹具；段落改过（哈希对不上）的整本作废，返回 null。 */
export function loadUserBookVectors(passages, path = USER_BOOK_VECTORS_PATH) {
  let raw
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
  if (!Array.isArray(raw?.passages) || raw.passages.length !== passages.length) return null
  const fresh = raw.passages.every((entry, at) => entry.textHash === textHashOf(passageEmbeddingText(passages[at])))
  if (!fresh) return null
  const identity = { providerHash: raw.providerHash, model: raw.model, dimensions: raw.dimensions, ruleVersion: raw.ruleVersion }
  return { identity, vectors: raw.passages.map(({ vector }) => vector) }
}

/** 用夹具拼出和聊天时一样的「书架」（toShelfBook），交给 pickPassage 挑段。 */
export function standInShelf({ book, passages }, fixture) {
  return [toShelfBook({
    id: 'stand-in', title: book.meta.title, author: book.meta.author, indexIdentity: fixture.identity,
    passages: passages.map((passage, at) => ({ id: `p${passage.seq}`, ...passage, vector: fixture.vectors[at] })),
  })]
}

/** 检验集里拿来标定她的书的句子：期望里有这本书某一章的（翻到其中一章就算对），和「不该翻书」的。 */
export function userBookCases(cases) {
  return cases
    .map((item) => ({ ...item, want: item.expect.filter((key) => key.startsWith(`${STAND_IN}/`)) }))
    .filter((item) => item.want.length || item.kind === 'negative')
}

/** 这一句在她的书里翻到哪一章（<书>/<章> 的 key），不翻返回 null；门槛和聊天时一样（userBookSearch）。 */
export function predictUserPassage(item, { vectors, shelf, chapterKeys, minScore = PASSAGE_MIN_SCORE }) {
  const search = userBookSearch(item.text)
  const queryEmbedding = search ? queryEmbeddingFor(item, vectors) : null
  const best = queryEmbedding && pickPassage(shelf, { text: item.text, queryEmbedding, namedOnly: search.namedOnly, minScore })
  return best ? chapterKeys[best.passage.chapterIndex] : null
}

/** 翻对章、翻错章、漏翻、误翻（不该翻书却翻了）各几句。 */
export function scoreUserBook(cases, predict) {
  const score = { positives: 0, right: 0, wrong: 0, missed: 0, negatives: 0, falsePositives: 0, mistakes: [] }
  for (const item of cases) {
    const got = predict(item)
    if (!item.want.length) {
      score.negatives += 1
      if (got) { score.falsePositives += 1; score.mistakes.push({ id: item.id, want: [], got }) }
      continue
    }
    score.positives += 1
    if (!got) { score.missed += 1; score.mistakes.push({ id: item.id, want: item.want, got: null }) } else if (item.want.includes(got)) {
      score.right += 1
    } else {
      score.wrong += 1
      score.mistakes.push({ id: item.id, want: item.want, got })
    }
  }
  return score
}
