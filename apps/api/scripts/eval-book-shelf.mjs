#!/usr/bin/env node
/**
 * 书架选章评测（路线图 C21 第二步，见 docs/04-开发/书架选章评测.md）：
 *
 *   pnpm --filter cyber-sister-server eval:books
 *
 * 不联网：在检验集上比「只用关键词」和「加上向量」两种做法各翻对了多少章。
 * 有书架索引和检验句的向量（books:index --live 生成）时，再把阈值从 0.30 扫到 0.85，看召回和误翻怎么此消彼长。
 */
import {
  loadBookShelfCases, loadQueryVectors, loadUserBookVectors, KINDS, predictCards, predictUserPassage, promptBudget,
  scoreBookShelf, scoreUserBook, standInBook, standInShelf, userBookCases, validateBookShelfCases,
} from '../src/eval/bookShelfEval.js'
import { PASSAGE_MIN_SCORE } from '../src/services/bookIndexService.js'
import { providerHashOf, shelfIndex } from '../src/services/bookShelf.js'

const set = loadBookShelfCases()
const problems = validateBookShelfCases(set)
if (problems.length) {
  console.error(`检验集有问题：\n${problems.join('\n')}`)
  process.exit(1)
}

function budget(title, result) {
  console.log(`\n${title}：${result.cases} 句里 ${result.withBooks} 句带了书，这一轮提示词平均多 ${result.average} 字，最多多 ${result.max} 字。`)
}

const percent = (value) => (value === null ? '—' : `${Math.round(value * 100)}%`)
function table(title, score) {
  console.log(`\n## ${title}\n`)
  console.log('| 类别 | 句数 | 全对 | 召回 | 精确 |')
  console.log('| --- | --- | --- | --- | --- |')
  for (const [kind, label] of Object.entries(KINDS)) {
    const row = score.byKind[kind]
    console.log(`| ${label} | ${row.cases} | ${row.exact} | ${percent(row.recall)} | ${kind === 'negative' ? `误翻 ${score.negativesWithBooks} 句` : percent(row.precision)} |`)
  }
  const all = score.overall
  console.log(`| 合计 | ${all.cases} | ${all.exact} | ${percent(all.recall)} | ${percent(all.precision)} |`)
  if (score.mistakes.length) {
    console.log('\n没全对的句子：')
    for (const { id, expect, predicted } of score.mistakes) console.log(`- ${id}：该翻 ${expect.join('、') || '（不翻）'}，翻了 ${predicted.join('、') || '（没翻）'}`)
  }
}

console.log(`# 书架选章评测\n\n检验集 v${set.version}（${set.status === 'frozen' ? `已冻结 ${set.frozenAt}` : '草案，未冻结'}），${set.cases.length} 句。`)
table('只用关键词', scoreBookShelf(set.cases, (item) => predictCards(item)))
budget('只用关键词时的字数', promptBudget(set.cases))

const index = shelfIndex()
const vectors = loadQueryVectors()
const comparable = index && vectors && vectors.identity.providerHash === providerHashOf(index)
  && vectors.identity.model === index.model && vectors.identity.dimensions === index.dimensions
if (!comparable) {
  console.log('\n还没有书架索引或检验句的向量（或两者不是同一个向量模型算的）：先跑 books:index -- --live（要花钱，先问产品负责人）。')
  process.exit(0)
}

console.log(`\n向量模型 ${index.model}（${index.dimensions} 维），索引阈值 ${index.minScore}。`)
table(`加上向量（阈值 ${index.minScore}）`, scoreBookShelf(set.cases, (item) => predictCards(item, { vectors, index })))
budget('加上向量时的字数', promptBudget(set.cases, { vectors, index }))

console.log('\n## 阈值扫描\n')
console.log('| 阈值 | 评测原句全对 | 换说法 + 口语召回 | 误翻（不该翻书的句数） | 合计精确 |')
console.log('| --- | --- | --- | --- | --- |')
for (let step = 30; step <= 85; step += 5) {
  const minScore = step / 100
  const score = scoreBookShelf(set.cases, (item) => predictCards(item, { vectors, index: { ...index, minScore } }))
  const { paraphrase, spoken, keyword } = score.byKind
  const recall = (paraphrase.correct + spoken.correct) / (paraphrase.expected + spoken.expected)
  console.log(`| ${minScore.toFixed(2)} | ${keyword.exact}/${keyword.cases} | ${percent(recall)} | ${score.negativesWithBooks} | ${percent(score.overall.precision)} |`)
}

// 她的书（路线图 C22）：拿《情绪急救》的改编章节冒充一本她上传的书，看 PASSAGE_MIN_SCORE 定在哪儿
const standIn = standInBook()
const fixture = loadUserBookVectors(standIn.passages)
if (!fixture || fixture.identity.providerHash !== vectors.identity.providerHash || fixture.identity.model !== vectors.identity.model) {
  console.log('\n还没有她的书的段落向量（或不是同一个向量模型算的）：先跑 books:user-fixture -- --live。')
  process.exit(0)
}
const shelf = standInShelf(standIn, fixture)
const userCases = userBookCases(set.cases)
const positives = userCases.filter(({ want }) => want.length).length
console.log('\n## 她的书（拿《情绪急救》改编章节冒充她上传的书）\n')
console.log(`切成 ${standIn.passages.length} 段；${positives} 句该翻到对应的章，${userCases.length - positives} 句不该翻书。当前阈值 ${PASSAGE_MIN_SCORE}。\n`)
console.log('| 阈值 | 翻对章 | 翻错章 | 漏翻 | 误翻（不该翻书的句数） |')
console.log('| --- | --- | --- | --- | --- |')
for (let step = 30; step <= 85; step += 5) {
  const minScore = step / 100
  const score = scoreUserBook(userCases, (item) => predictUserPassage(item, { vectors, shelf, chapterKeys: standIn.chapterKeys, minScore }))
  console.log(`| ${minScore.toFixed(2)} | ${score.right}/${score.positives} | ${score.wrong} | ${score.missed} | ${score.falsePositives} |`)
}
const current = scoreUserBook(userCases, (item) => predictUserPassage(item, { vectors, shelf, chapterKeys: standIn.chapterKeys }))
if (current.mistakes.length) {
  console.log(`\n阈值 ${PASSAGE_MIN_SCORE} 时没翻对的句子：`)
  for (const { id, want, got } of current.mistakes) console.log(`- ${id}：该翻 ${want.join('、') || '（不翻）'}，翻了 ${got ?? '（没翻）'}`)
}
