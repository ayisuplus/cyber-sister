#!/usr/bin/env node
/**
 * 书架索引（路线图 C21 第二步，见 docs/04-开发/书架选章评测.md）：
 *
 *   pnpm --filter cyber-sister-server books:index                 不联网：只列出要算多少次向量
 *   pnpm --filter cyber-sister-server books:index -- --live       真的算：要花钱，跑之前先问产品负责人
 *
 * 可选 --min-score 0.5：写进索引的阈值（默认沿用已有索引的，没有就 0.5）；先用 eval:books 在检验集上扫一遍再定。
 * 用 apps/api/.env 里的 MEMORY_EMBEDDING_*，和记忆是同一个向量模型；密钥不打印，供应商地址只存哈希。
 * 算两样，都只有我们自己写的文字、没有用户数据：
 *   书架上每张章节卡 → src/skills/book-index.json（聊天时用）
 *   检验集每一句     → tests/book-shelf/query-vectors.json（离线评测用，CI 里不再调接口）
 */
import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { loadRuntimeSecrets } from '../src/config/runtime.js'
import { embeddingConfig } from '../src/services/embeddingConfig.js'
import { embedText } from '../src/services/embeddingService.js'
import { BOOKS } from '../src/services/bookSkills.js'
import { BOOK_INDEX_PATH, cardEmbeddingText, providerHashOf } from '../src/services/bookShelf.js'
import { QUERY_VECTORS_PATH, loadBookShelfCases, textHashOf, validateBookShelfCases } from '../src/eval/bookShelfEval.js'

const args = process.argv.slice(2).filter((arg) => arg !== '--')
const optionOf = (name) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}
const live = args.includes('--live')

function previousMinScore() {
  try {
    return JSON.parse(readFileSync(BOOK_INDEX_PATH, 'utf8')).minScore
  } catch {
    return undefined
  }
}
const minScore = Number(optionOf('--min-score') ?? previousMinScore() ?? 0.5)
if (!(minScore > 0 && minScore < 1)) {
  console.error('[书架索引] --min-score 要在 0 和 1 之间')
  process.exit(1)
}

loadRuntimeSecrets()
const config = embeddingConfig()
const cards = BOOKS.flatMap((book) => book.cards)
const set = loadBookShelfCases()
const problems = validateBookShelfCases(set)
if (problems.length) {
  console.error(`[书架索引] 检验集有问题，先改好：\n${problems.join('\n')}`)
  process.exit(1)
}

console.log(`[书架索引] 向量模型：${config ? `已配置（${config.model}，${config.dimensions} 维）` : '没配置 MEMORY_EMBEDDING_*，建不了索引，聊天时选章只用关键词'}`)
console.log(`[书架索引] 要算 ${cards.length} 张章节卡 + ${set.cases.length} 句检验句 = ${cards.length + set.cases.length} 次向量调用；阈值 ${minScore}`)
if (!live) {
  console.log('[书架索引] 没有联网。加 --live 才真的调用（要花钱，先问产品负责人）。')
  process.exit(config ? 0 : 1)
}
if (!config) process.exit(1)

const round = (vector) => vector.map((value) => Number(value.toFixed(6)))
async function embedAll(items, textOf) {
  const out = []
  for (const item of items) {
    const vector = await embedText(textOf(item), { config })
    if (!vector) throw new Error(`没算出来：${item.key ?? item.id}`)
    out.push({ item, vector: round(vector) })
    process.stdout.write('.')
  }
  process.stdout.write('\n')
  return out
}

const identity = { providerHash: providerHashOf(config), model: config.model, dimensions: config.dimensions, ruleVersion: config.ruleVersion }
const builtAt = new Date().toISOString()
try {
  // 全部算完才写文件：中途失败不留下一半新一半旧的索引
  const cardVectors = await embedAll(cards, cardEmbeddingText)
  const queryVectors = await embedAll(set.cases, (item) => item.text)
  writeFileSync(BOOK_INDEX_PATH, `${JSON.stringify({
    note: '书架索引：章节卡「章名 + 用途 + 正文」的向量，由 scripts/index-book-cards.mjs 生成。卡片改了要重建，否则那一张只看关键词。',
    ...identity, minScore, builtAt,
    cards: cardVectors.map(({ item, vector }) => ({ key: item.key, hash: item.hash, vector })),
  })}\n`, 'utf8')
  writeFileSync(QUERY_VECTORS_PATH, `${JSON.stringify({
    note: '书架选章检验集每一句的向量（离线评测用），由 scripts/index-book-cards.mjs 生成。句子改了要重建，否则那一句只看关键词。',
    ...identity, builtAt,
    queries: queryVectors.map(({ item, vector }) => ({ id: item.id, textHash: textHashOf(item.text), vector })),
  })}\n`, 'utf8')
  console.log(`[书架索引] 写好了：${BOOK_INDEX_PATH}\n[书架索引] 检验集向量：${QUERY_VECTORS_PATH}\n[书架索引] 接着跑 eval:books 看两种做法各对了多少`)
} catch (error) {
  console.error(`[书架索引] 没建成，文件都没动：${error.message}`)
  process.exit(1)
}
