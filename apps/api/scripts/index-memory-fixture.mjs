#!/usr/bin/env node
/**
 * 记忆检索评测的向量夹具（路线图 C23 第四步，见 docs/04-开发/记忆检索评测.md）：
 *
 *   pnpm --filter cyber-sister-server memories:fixture             不联网：只列出要算多少次
 *   pnpm --filter cyber-sister-server memories:fixture -- --live   真的算
 *
 * 检验集里的每条记忆、每句话各算一个向量，写进 tests/memory-retrieval/vectors.json；eval:memories 和 CI 用它离线评测。
 * 和聊天时一样一条一条算（记忆：embedMemory；这一轮的话：embedQuery，都走 embedText），只有虚构的检验集文字，没有用户数据。
 * 用 apps/api/.env 里的 MEMORY_EMBEDDING_*（本机向量服务不花钱；配的是云端就会按量计费，先问产品负责人）。
 */
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { loadRuntimeSecrets } from '../src/config/runtime.js'
import { embeddingConfig } from '../src/services/embeddingConfig.js'
import { embedText } from '../src/services/embeddingService.js'
import { identityOf } from '../src/services/vectors/identity.js'
import { textHashOf } from '../src/eval/bookShelfEval.js'
import { MEMORY_VECTORS_PATH, loadMemoryCases, validateMemoryCases } from '../src/eval/memoryRetrievalEval.js'

const live = process.argv.includes('--live')

loadRuntimeSecrets()
const config = embeddingConfig()
const set = loadMemoryCases()
const problems = validateMemoryCases(set)
if (problems.length) {
  console.error(`[记忆夹具] 检验集有问题，先改好：\n${problems.join('\n')}`)
  process.exit(1)
}
console.log(`[记忆夹具] 向量模型：${config ? `已配置（${config.model}，${config.dimensions} 维）` : '没配置 MEMORY_EMBEDDING_*'}`)
console.log(`[记忆夹具] 要算 ${set.memories.length} 条记忆 + ${set.cases.length} 句话 = ${set.memories.length + set.cases.length} 次`)
if (!live) {
  console.log('[记忆夹具] 没有联网。加 --live 才真的调用。')
  process.exit(config ? 0 : 1)
}
if (!config) process.exit(1)

const round = (vector) => vector.map((value) => Number(value.toFixed(6)))
async function embedAll(items, textOf) {
  const out = []
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop -- 和聊天时一样一条一条算
    const vector = await embedText(textOf(item), { config })
    if (!vector) throw new Error(`没算出来：${item.id}`)
    out.push({ id: item.id, textHash: textHashOf(textOf(item)), vector: round(vector) })
    process.stdout.write('.')
  }
  process.stdout.write('\n')
  return out
}

try {
  // 全部算完才写文件：中途失败不留下一半新一半旧的夹具
  const memories = await embedAll(set.memories, (memory) => memory.content)
  const queries = await embedAll(set.cases, (item) => item.text)
  writeFileSync(MEMORY_VECTORS_PATH, `${JSON.stringify({
    note: '记忆检索评测的向量夹具：检验集里每条记忆、每句话的向量，由 scripts/index-memory-fixture.mjs 生成。改了哪条的文字，那一条就只看关键词，直到重建。',
    ...identityOf(config),
    builtAt: new Date().toISOString(),
    memories,
    queries,
  })}\n`, 'utf8')
  console.log(`[记忆夹具] 写好了：${MEMORY_VECTORS_PATH}\n[记忆夹具] 接着跑 eval:memories`)
} catch (error) {
  console.error(`[记忆夹具] ${error.message}（向量服务没起来？），文件没动`)
  process.exit(1)
}
