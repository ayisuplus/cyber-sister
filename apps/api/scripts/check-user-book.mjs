#!/usr/bin/env node
/**
 * 她的书：拿一本真书在本机核对 PASSAGE_MIN_SCORE（路线图 C22，见 docs/04-开发/书架选章评测.md「她的书」一节）。
 *
 *   node apps/web/scripts/extract-book-chapters.mjs book/<书>.epub <临时目录>/book.json
 *   pnpm --filter cyber-sister-server books:check-user -- <临时目录>/book.json [--origin]
 *
 * 全书正文只在这台机器上：向量服务必须是本机（localhost / 127.0.0.1），否则不跑。
 * 只打印数字和章名，不打印正文，也不写文件。
 * --origin：这本就是《情绪急救》原书，按「第N章」核对翻到的章对不对；不加时只看「不该翻书」的句子有没有被翻到。
 * --detail 0.55：再列出这个阈值下每句翻到了哪一章（只有句子 id、章名和分数）。
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { loadRuntimeSecrets } from '../src/config/runtime.js'
import { embeddingConfig } from '../src/services/embeddingConfig.js'
import { embedTexts } from '../src/services/embeddingService.js'
import { BOOKS, userBookSearch } from '../src/services/bookSkills.js'
import { chunkBook, identityOf, passageEmbeddingText, pickPassage, PASSAGE_MIN_SCORE, toShelfBook, validateChapters } from '../src/services/bookIndexService.js'
import { loadBookShelfCases, loadQueryVectors, queryEmbeddingFor, userBookCases } from '../src/eval/bookShelfEval.js'

const args = process.argv.slice(2).filter((arg) => arg !== '--')
const input = args.find((arg, at) => !arg.startsWith('--') && args[at - 1] !== '--detail')
const checkOrigin = args.includes('--origin')
const detailAt = args.includes('--detail') ? Number(args[args.indexOf('--detail') + 1]) : null
const BATCH = 32

if (!input) {
  console.error('用法：books:check-user -- <章节.json> [--origin]')
  process.exit(1)
}

loadRuntimeSecrets()
const config = embeddingConfig()
if (!config || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.provider).hostname)) {
  console.error('[真书核对] 向量服务不是本机，不跑：真书正文不发到别的机器。')
  process.exit(1)
}
const vectors = loadQueryVectors()
if (!vectors || vectors.identity.model !== config.model || vectors.identity.dimensions !== config.dimensions) {
  console.error('[真书核对] 检验句的向量不是这个模型算的，先跑 books:index -- --live')
  process.exit(1)
}

const book = JSON.parse(readFileSync(input, 'utf8'))
const chapters = validateChapters({ chapters: book.chapters })
const passages = chunkBook(chapters)
console.log(`[真书核对] ${chapters.length} 章，切成 ${passages.length} 段；向量模型 ${config.model}`)

const started = Date.now()
const passageVectors = []
for (let from = 0; from < passages.length; from += BATCH) {
  // eslint-disable-next-line no-await-in-loop -- 和上传时一样一批一批算
  const batch = await embedTexts(passages.slice(from, from + BATCH).map(passageEmbeddingText), { config })
  if (!batch) {
    console.error('[真书核对] 有一批没算出来')
    process.exit(1)
  }
  passageVectors.push(...batch)
  process.stdout.write('.')
}
console.log(`\n[真书核对] 算完 ${passages.length} 段，用时 ${Math.round((Date.now() - started) / 1000)} 秒`)

const shelf = [toShelfBook({
  id: 'real-book', title: book.title || '真书', author: book.author || null, indexIdentity: identityOf(config),
  passages: passages.map((passage, at) => ({ id: `p${passage.seq}`, ...passage, vector: passageVectors[at] })),
})]
// 检验句的向量就是聊天时找记忆算的那种；身份按这台机器的配置对齐
const cases = userBookCases(loadBookShelfCases().cases)
const originOf = new Map(BOOKS.flatMap((item) => item.cards).map((card) => [card.key, card.origin]))
const compact = (text) => String(text ?? '').replace(/\s+/g, '')

function pick(item, minScore) {
  const search = userBookSearch(item.text)
  const stored = search ? queryEmbeddingFor(item, vectors) : null
  if (!stored) return null
  return pickPassage(shelf, { text: item.text, queryEmbedding: { ...stored, ...identityOf(config) }, namedOnly: search.namedOnly, minScore })
}

console.log(`\n当前阈值 ${PASSAGE_MIN_SCORE}。${checkOrigin ? '按原书「第N章」核对。' : '只看不该翻书的句子。'}\n`)
console.log(checkOrigin ? '| 阈值 | 翻对章 | 翻错章 | 漏翻 | 误翻 |' : '| 阈值 | 情绪类句子翻到的 | 误翻（不该翻书的句数） |')
console.log(checkOrigin ? '| --- | --- | --- | --- | --- |' : '| --- | --- | --- |')
for (let step = 30; step <= 70; step += 5) {
  const minScore = step / 100
  const tally = { right: 0, wrong: 0, missed: 0, hit: 0, falsePositives: 0 }
  for (const item of cases) {
    const best = pick(item, minScore)
    if (!item.want.length) { if (best) tally.falsePositives += 1; continue }
    if (!best) { tally.missed += 1; continue }
    tally.hit += 1
    const title = compact(chapters[best.passage.chapterIndex].title)
    if (item.want.some((key) => title.startsWith(compact(originOf.get(key))))) tally.right += 1
    else tally.wrong += 1
  }
  const positives = cases.filter(({ want }) => want.length).length
  console.log(checkOrigin
    ? `| ${minScore.toFixed(2)} | ${tally.right}/${positives} | ${tally.wrong} | ${tally.missed} | ${tally.falsePositives} |`
    : `| ${minScore.toFixed(2)} | ${tally.hit}/${positives} | ${tally.falsePositives} |`)
}

if (detailAt) {
  console.log(`\n阈值 ${detailAt} 时每句翻到的章：`)
  for (const item of cases) {
    const best = pick(item, detailAt)
    const want = item.want.map((key) => originOf.get(key)).join('、') || '（不翻）'
    const got = best ? `${chapters[best.passage.chapterIndex].title.slice(0, 24)}（${best.score.toFixed(3)}）` : '（没翻）'
    console.log(`- ${item.id}：该翻 ${want}，翻了 ${got}`)
  }
}
