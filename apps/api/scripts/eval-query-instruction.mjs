#!/usr/bin/env node
/**
 * 查询加任务说明的对照实验（路线图 C23 待裁定项，见 docs/04-开发/记忆检索评测.md「查询加任务说明」一节）：
 *
 *   pnpm --filter cyber-sister-server eval:query-instruction             不联网：只列出要算多少次
 *   pnpm --filter cyber-sister-server eval:query-instruction -- --live   真的算（本机向量服务，不花钱）
 *
 * Qwen3-Embedding 建议只在查询一侧加一句任务说明（Instruct: …\nQuery:…），文档一侧不加。
 * 这里记忆、书卡、段落的向量都不动（用进仓库的夹具与书架索引），只把这一轮的话按几种写法重算，
 * 在记忆检索、书架选章、她的书三份检验集上，各按原来定阈值的标准找最低的安全阈值，比召回。
 * 聊天时一句话只算一个查询向量、记忆和书共用：所以既要看专为记忆写的说明，也要看两边共用的说明。
 * 只比较，不改聊天时的行为；结果不写文件。
 */
import 'dotenv/config'
import { loadRuntimeSecrets } from '../src/config/runtime.js'
import { embeddingConfig } from '../src/services/embeddingConfig.js'
import { embedText } from '../src/services/embeddingService.js'
import { identityOf, sameModel } from '../src/services/vectors/identity.js'
import { shelfIndex } from '../src/services/bookShelf.js'
import {
  loadBookShelfCases, loadUserBookVectors, predictCards, predictUserPassage, scoreBookShelf, scoreUserBook,
  standInBook, standInShelf, textHashOf, userBookCases,
} from '../src/eval/bookShelfEval.js'
import {
  loadMemoryCases, loadMemoryVectors, memoriesWithVectors, noiseFromVectors, predictMemories, scoreMemoryRetrieval,
} from '../src/eval/memoryRetrievalEval.js'

/** 四种写法：现行（不加）、专为记忆写的英文 / 中文说明、记忆和书共用的英文说明（Qwen3 建议用英文写说明）。 */
export const ARMS = {
  none: { label: '不加（现行）', task: null },
  memoryEn: { label: '记忆专用（英文）', task: 'Given a message a user sends to her AI companion, retrieve her own saved memories that are relevant to what she is saying' },
  memoryZh: { label: '记忆专用（中文）', task: '给定她对陪伴助手说的一句话，找出她自己记下的、和这句话有关的记忆' },
  sharedEn: { label: '记忆与书共用（英文）', task: 'Given a message a young woman sends to her AI companion late at night, retrieve her saved memories or book passages that relate to what she is going through' },
}
const withTask = (task, text) => (task ? `Instruct: ${task}\nQuery:${text}` : text)

const live = process.argv.includes('--live')
loadRuntimeSecrets()
const config = embeddingConfig()
const memorySet = loadMemoryCases()
const bookSet = loadBookShelfCases()
const perArm = memorySet.cases.length + bookSet.cases.length
console.log(`[任务说明] 向量模型：${config ? `已配置（${config.model}，${config.dimensions} 维）` : '没配置 MEMORY_EMBEDDING_*'}`)
console.log(`[任务说明] ${Object.keys(ARMS).length} 种写法 × ${perArm} 句 = ${Object.keys(ARMS).length * perArm} 次`)
if (!live) {
  console.log('[任务说明] 没有联网。加 --live 才真的调用。')
  process.exit(config ? 0 : 1)
}
if (!config) process.exit(1)

const memoryVectors = loadMemoryVectors()
const index = shelfIndex()
const standIn = standInBook()
const passageFixture = loadUserBookVectors(standIn.passages)
const identity = identityOf(config)
if (!memoryVectors || !index || !passageFixture || !sameModel(identity, memoryVectors.identity) || !sameModel(identity, index)) {
  console.error('[任务说明] 记忆夹具、书架索引或她的书夹具缺了，或不是现在这个模型算的：先重建它们')
  process.exit(1)
}

async function queryVectors(task, cases) {
  const byId = new Map()
  for (const item of cases) {
    // eslint-disable-next-line no-await-in-loop -- 和聊天时一样一条一条算
    const vector = await embedText(withTask(task, item.text), { config })
    if (!vector) throw new Error(`没算出来：${item.id}（向量服务没起来？）`)
    byId.set(item.id, { textHash: textHashOf(item.text), vector })
  }
  return byId
}

const STEPS = Array.from({ length: 56 }, (_, at) => (30 + at) / 100)
const firstSafe = (isSafe) => STEPS.find(isSafe) ?? null
const percent = (value) => (value === null || Number.isNaN(value) ? '—' : `${Math.round(value * 100)}%`)
const ofKinds = (score, kinds) => ({ ...score, details: score.details.filter((row) => kinds.includes(row.kind)) })

/** 记忆：不该带、字面撞车、字面对得上三类，向量一条无关记忆也不多带、字面的全找到；最低的这一档召回多少。 */
function memoryResult(queries) {
  const vectors = { ...memoryVectors, queries }
  const memories = memoriesWithVectors(memorySet, vectors)
  const plain = memoriesWithVectors(memorySet)
  const keywordOnly = scoreMemoryRetrieval(memorySet.cases, (item) => predictMemories(item, plain))
  const guarded = ['negative', 'trap', 'literal']
  const scoreAt = (minScore) => scoreMemoryRetrieval(memorySet.cases, (item) => predictMemories(item, memories, { vectors, minScore }))
  const threshold = firstSafe((minScore) => {
    const score = scoreAt(minScore)
    return score.byKind.literal.recall === 1 && noiseFromVectors(ofKinds(score, guarded), ofKinds(keywordOnly, guarded)) === 0
  })
  const indirect = (score) => (score.byKind.paraphrase.hits + score.byKind.spoken.hits) / (score.byKind.paraphrase.expected + score.byKind.spoken.expected)
  const safe = threshold === null ? null : scoreAt(threshold)
  return { threshold, recall: safe && indirect(safe), noise: safe?.overall.noise ?? null, recallAtCurrent: indirect(scoreAt(0.52)) }
}

/** 书卡：评测原句全翻对、不该翻书的一章不翻、翻到的章都对（精确 100%，书架定 0.50 的标准）；最低的这一档，换说法 + 口语翻对多少。 */
function cardResult(byId) {
  const vectors = { identity: index, byId }
  const scoreAt = (minScore) => scoreBookShelf(bookSet.cases, (item) => predictCards(item, { vectors, index: { ...index, minScore } }))
  const threshold = firstSafe((minScore) => {
    const score = scoreAt(minScore)
    return score.negativesWithBooks === 0 && score.byKind.keyword.exact === score.byKind.keyword.cases && score.overall.precision === 1
  })
  const indirect = (score) => (score.byKind.paraphrase.correct + score.byKind.spoken.correct) / (score.byKind.paraphrase.expected + score.byKind.spoken.expected)
  return { threshold, recall: threshold === null ? null : indirect(scoreAt(threshold)), recallAtCurrent: indirect(scoreAt(index.minScore)) }
}

/**
 * 她的书：不该翻书的一句不翻、翻到的都是对应的章；最低的这一档翻对几句。
 * 只有进仓库的冒充书（7 段）；定 0.55 时还在本机三本真书上核对过，这里核对不了，所以这一列的「安全阈值」偏低、只作对比。
 */
function passageResult(byId) {
  const vectors = { identity: index, byId }
  const shelf = standInShelf(standIn, passageFixture)
  const cases = userBookCases(bookSet.cases)
  const scoreAt = (minScore) => scoreUserBook(cases, (item) => predictUserPassage(item, { vectors, shelf, chapterKeys: standIn.chapterKeys, minScore }))
  const threshold = firstSafe((minScore) => {
    const score = scoreAt(minScore)
    return score.falsePositives === 0 && score.wrong === 0
  })
  const safe = threshold === null ? null : scoreAt(threshold)
  return { threshold, right: safe ? `${safe.right}/${safe.positives}` : '—', rightAtCurrent: `${scoreAt(0.55).right}/${scoreAt(0.55).positives}` }
}

try {
  const rows = []
  for (const [key, arm] of Object.entries(ARMS)) {
    process.stdout.write(`[任务说明] ${arm.label}……`)
    // eslint-disable-next-line no-await-in-loop -- 一种写法算完再算下一种
    const memoryQueries = await queryVectors(arm.task, memorySet.cases)
    // eslint-disable-next-line no-await-in-loop
    const bookQueries = await queryVectors(arm.task, bookSet.cases)
    rows.push({ key, arm, memory: memoryResult(memoryQueries), card: cardResult(bookQueries), passage: passageResult(bookQueries) })
    process.stdout.write('算完\n')
  }
  const fixed = (value) => (value === null ? '没有安全的一档' : value.toFixed(2))
  console.log('\n## 各自按原标准找最低的安全阈值\n')
  console.log('| 查询写法 | 记忆：安全阈值 | 记忆：换说法 + 碎碎念召回 | 记忆：多带条数 | 书卡：安全阈值 | 书卡：换说法 + 口语召回 | 她的书：安全阈值 | 她的书：翻对 |')
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const { arm, memory, card, passage } of rows) {
    console.log(`| ${arm.label} | ${fixed(memory.threshold)} | ${percent(memory.recall)} | ${memory.noise ?? '—'} | ${fixed(card.threshold)} | ${percent(card.recall)} | ${fixed(passage.threshold)} | ${passage.right} |`)
  }
  console.log('\n## 阈值不动（记忆 0.52、书卡 0.50、她的书 0.55）时\n')
  console.log('| 查询写法 | 记忆：换说法 + 碎碎念召回 | 书卡：换说法 + 口语召回 | 她的书：翻对 |')
  console.log('| --- | --- | --- | --- |')
  for (const { arm, memory, card, passage } of rows) {
    console.log(`| ${arm.label} | ${percent(memory.recallAtCurrent)} | ${percent(card.recallAtCurrent)} | ${passage.rightAtCurrent} |`)
  }
  console.log('\n任务说明原文：')
  for (const { arm } of rows) if (arm.task) console.log(`- ${arm.label}：${arm.task}`)
} catch (error) {
  console.error(`\n[任务说明] ${error.message}`)
  process.exit(1)
}
