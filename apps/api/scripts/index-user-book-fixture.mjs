#!/usr/bin/env node
/**
 * 她的书的标定夹具（路线图 C22，见 docs/04-开发/书架选章评测.md「她的书」一节）：
 *
 *   pnpm --filter cyber-sister-server books:user-fixture             不联网：只列出要算多少段
 *   pnpm --filter cyber-sister-server books:user-fixture -- --live   真的算
 *
 * 拿《情绪急救》的改编章节冒充一本她上传的书，按上传时的规则切段，用和上传时一样的批量接口算向量，
 * 写进 tests/book-shelf/user-book-vectors.json；eval:books 和 CI 用它离线标定 PASSAGE_MIN_SCORE。
 * 只有我们自己写的改编文字，没有用户数据，也没有原书全文。
 * 用 apps/api/.env 里的 MEMORY_EMBEDDING_*（本机向量服务不花钱；配的是云端就会按量计费，先问产品负责人）。
 */
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { loadRuntimeSecrets } from '../src/config/runtime.js'
import { embeddingConfig } from '../src/services/embeddingConfig.js'
import { embedTexts } from '../src/services/embeddingService.js'
import { providerHashOf } from '../src/services/bookShelf.js'
import { passageEmbeddingText } from '../src/services/bookIndexService.js'
import { USER_BOOK_VECTORS_PATH, standInBook, textHashOf } from '../src/eval/bookShelfEval.js'

const live = process.argv.includes('--live')
const BATCH = 32

loadRuntimeSecrets()
const config = embeddingConfig()
const { book, passages } = standInBook()
console.log(`[她的书夹具] 向量模型：${config ? `已配置（${config.model}，${config.dimensions} 维）` : '没配置 MEMORY_EMBEDDING_*'}`)
console.log(`[她的书夹具] 《${book.meta.title}》改编章节 ${book.cards.length} 章，切成 ${passages.length} 段，分 ${Math.ceil(passages.length / BATCH)} 批算`)
if (!live) {
  console.log('[她的书夹具] 没有联网。加 --live 才真的调用。')
  process.exit(config ? 0 : 1)
}
if (!config) process.exit(1)

const round = (vector) => vector.map((value) => Number(value.toFixed(6)))
const vectors = []
for (let from = 0; from < passages.length; from += BATCH) {
  // eslint-disable-next-line no-await-in-loop -- 和上传时一样一批一批算
  const batch = await embedTexts(passages.slice(from, from + BATCH).map(passageEmbeddingText), { config })
  if (!batch) {
    console.error('[她的书夹具] 有一批没算出来，文件没动')
    process.exit(1)
  }
  vectors.push(...batch.map(round))
}

writeFileSync(USER_BOOK_VECTORS_PATH, `${JSON.stringify({
  note: '她的书的标定夹具：《情绪急救》改编章节按上传规则切成的段落向量，由 scripts/index-user-book-fixture.mjs 生成。卡片或切段规则改了要重建，否则这一节评测跳过。',
  providerHash: providerHashOf(config), model: config.model, dimensions: config.dimensions, ruleVersion: config.ruleVersion,
  builtAt: new Date().toISOString(),
  passages: passages.map((passage, at) => ({ seq: passage.seq, locator: passage.locator, textHash: textHashOf(passageEmbeddingText(passage)), vector: vectors[at] })),
})}\n`, 'utf8')
console.log(`[她的书夹具] 写好了：${USER_BOOK_VECTORS_PATH}\n[她的书夹具] 接着跑 eval:books 看「她的书」一节`)
