#!/usr/bin/env node
/**
 * 记忆检索评测（路线图 C23 第四步，见 docs/04-开发/记忆检索评测.md）：
 *
 *   pnpm --filter cyber-sister-server eval:memories
 *
 * 不联网：在检验集上比「只用关键词与标签」和「加上向量」两种做法，聊天时带进来的记忆各对了多少。
 * 有记忆与检验句的向量（memories:fixture -- --live 生成）时，再把阈值从 0.30 扫到 0.80（0.45–0.60 每 0.01 一档），看召回和误带怎么此消彼长。
 */
import {
  loadMemoryCases, loadMemoryVectors, MEMORY_KINDS, memoriesWithVectors, noiseFromVectors, predictMemories,
  scoreMemoryRetrieval, validateMemoryCases,
} from '../src/eval/memoryRetrievalEval.js'
import { SEMANTIC_MEMORY_MIN_SCORE } from '../src/services/llmService.js'

const set = loadMemoryCases()
const problems = validateMemoryCases(set)
if (problems.length) {
  console.error(`检验集有问题：\n${problems.join('\n')}`)
  process.exit(1)
}

const percent = (value) => (value === null ? '—' : `${Math.round(value * 100)}%`)
function table(title, score) {
  console.log(`\n## ${title}\n`)
  console.log('| 类别 | 句数 | 该带的都带了 | 召回 | 带了无关记忆的句数 | 多带的条数 |')
  console.log('| --- | --- | --- | --- | --- | --- |')
  for (const [kind, label] of Object.entries(MEMORY_KINDS)) {
    const row = score.byKind[kind]
    console.log(`| ${label} | ${row.cases} | ${row.expected ? row.allFound : '—'} | ${percent(row.recall)} | ${row.noisyCases} | ${row.noise} |`)
  }
  const all = score.overall
  console.log(`| 合计 | ${all.cases} | — | ${percent(all.recall)} | ${all.noisyCases} | ${all.noise} |`)
  if (score.mistakes.length) {
    console.log('\n没全对的句子：')
    for (const { id, missed, noise } of score.mistakes) {
      console.log(`- ${id}：${missed.length ? `漏了 ${missed.join('、')}` : ''}${missed.length && noise.length ? '；' : ''}${noise.length ? `多带 ${noise.join('、')}` : ''}`)
    }
  }
}

console.log(`# 记忆检索评测\n\n检验集 v${set.version}（${set.status === 'frozen' ? `已冻结 ${set.frozenAt}` : '草案，未冻结'}），${set.memories.length} 条记忆、${set.cases.length} 句。每句最多带 5 条。`)
const plain = memoriesWithVectors(set)
const keywordOnly = scoreMemoryRetrieval(set.cases, (item) => predictMemories(item, plain))
table('只用关键词与标签', keywordOnly)

const vectors = loadMemoryVectors()
if (!vectors) {
  console.log('\n还没有记忆与检验句的向量：先跑 memories:fixture -- --live（本机向量服务，不花钱）。')
  process.exit(0)
}
const memories = memoriesWithVectors(set, vectors)
const stale = memories.filter((memory) => !memory.semantic).length
const missingQueries = set.cases.filter((item) => !vectors.queries.has(item.id)).length
console.log(`\n向量模型 ${vectors.identity.model}（${vectors.identity.dimensions} 维）。${stale || missingQueries ? `有 ${stale} 条记忆、${missingQueries} 句话没有对得上的向量（改过之后没重算），这几条只看关键词。` : ''}`)
const current = scoreMemoryRetrieval(set.cases, (item) => predictMemories(item, memories, { vectors }))
table(`加上向量（现行阈值 ${SEMANTIC_MEMORY_MIN_SCORE}）`, current)

console.log('\n## 阈值扫描\n')
console.log('| 阈值 | 字面对得上：召回 | 换说法 + 碎碎念：召回 | 不该带记忆却带了（句数） | 多带的条数 | 其中向量带进来的 |')
console.log('| --- | --- | --- | --- | --- | --- |')
const row = (label, score) => {
  const { literal, paraphrase, spoken, negative } = score.byKind
  const indirect = (paraphrase.hits + spoken.hits) / (paraphrase.expected + spoken.expected)
  console.log(`| ${label} | ${percent(literal.recall)} | ${percent(indirect)} | ${negative.noisyCases}/${negative.cases} | ${score.overall.noise} | ${noiseFromVectors(score, keywordOnly)} |`)
}
row('只用关键词', keywordOnly)
// 0.30 到 0.80 每 0.05 一档；0.45 到 0.60 之间召回和误带变得最快，每 0.01 一档；现行阈值加粗
const grid = [...new Set([30, 35, 40, ...Array.from({ length: 16 }, (_, at) => 45 + at), 65, 70, 75, 80])].map((step) => step / 100)
for (const minScore of grid) {
  const label = minScore === SEMANTIC_MEMORY_MIN_SCORE ? `**${minScore.toFixed(2)}（现行）**` : minScore.toFixed(2)
  row(label, scoreMemoryRetrieval(set.cases, (item) => predictMemories(item, memories, { vectors, minScore })))
}

// 对照（2026-09-26 之前的做法）：关键词只撞上一个两字片段也算，不请向量作证
table(`对照：关键词撞车不请向量作证（阈值 ${SEMANTIC_MEMORY_MIN_SCORE}，2026-09-26 之前的做法）`,
  scoreMemoryRetrieval(set.cases, (item) => predictMemories(item, memories, { vectors, corroborate: false })))
