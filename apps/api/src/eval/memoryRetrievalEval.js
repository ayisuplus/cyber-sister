import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { retrieveRelevantMemories } from '../services/llmService.js'
import { contentVersion, identityKeyOf } from '../services/vectors/identity.js'
import { textHashOf } from './bookShelfEval.js'

/**
 * 记忆检索检验集（路线图 C23 第四步）：她说一句话，聊天时带进来的记忆对不对。
 * 走的就是聊天时那个函数（retrieveRelevantMemories：关键词 + 标签 + 向量分），不调模型、不联网：
 * 记忆和句子的向量事先由 scripts/index-memory-fixture.mjs 算好存成夹具。
 */
export const MEMORY_CASES_PATH = fileURLToPath(new URL('../../tests/memory-retrieval/cases.json', import.meta.url))
export const MEMORY_VECTORS_PATH = fileURLToPath(new URL('../../tests/memory-retrieval/vectors.json', import.meta.url))

export const MEMORY_KINDS = { literal: '字面对得上', paraphrase: '换个说法', spoken: '深夜碎碎念', negative: '不该带记忆', trap: '字面撞车' }
// 「该带」必须有的类别；不该带、字面撞车可以为空
const NEEDS_EXPECT = new Set(['literal', 'paraphrase', 'spoken'])

export function loadMemoryCases(path = MEMORY_CASES_PATH) {
  const set = JSON.parse(readFileSync(path, 'utf8'))
  return { ...set, cases: set.cases.map((item) => ({ ...item, allow: item.allow ?? [] })) }
}

/** 格式与引用检查：返回问题列表，空数组表示没问题。 */
export function validateMemoryCases(set) {
  const problems = []
  const memoryIds = new Set()
  for (const memory of set.memories ?? []) {
    if (memoryIds.has(memory.id)) problems.push(`${memory.id}：记忆 id 重复`)
    memoryIds.add(memory.id)
    if (typeof memory.content !== 'string' || !memory.content.trim()) problems.push(`${memory.id}：记忆没有正文`)
  }
  const seen = new Set()
  for (const item of set.cases ?? []) {
    if (seen.has(item.id)) problems.push(`${item.id}：id 重复`)
    seen.add(item.id)
    problems.push(...caseProblems(item, memoryIds))
  }
  return problems
}

function caseProblems(item, memoryIds) {
  const problems = []
  if (!MEMORY_KINDS[item.kind]) problems.push(`${item.id}：不认识的类别 ${item.kind}`)
  if (typeof item.text !== 'string' || !item.text.trim()) problems.push(`${item.id}：没有句子`)
  const allow = item.allow ?? []
  if (!Array.isArray(item.expect) || !Array.isArray(allow)) return [...problems, `${item.id}：expect / allow 不是数组`]
  for (const id of [...item.expect, ...allow]) if (!memoryIds.has(id)) problems.push(`${item.id}：没有记忆 ${id}`)
  if (allow.some((id) => item.expect.includes(id))) problems.push(`${item.id}：同一条记忆既在 expect 又在 allow`)
  if (NEEDS_EXPECT.has(item.kind) && !item.expect.length) problems.push(`${item.id}：${MEMORY_KINDS[item.kind]}的句子得标出该带哪条`)
  if (item.kind === 'negative' && item.expect.length) problems.push(`${item.id}：不该带记忆的句子 expect 应为空`)
  return problems
}

/**
 * 读向量夹具：记忆与句子各自按文字哈希核对，改过的那一条不给向量（等于没算过，只看关键词）。
 * 没有夹具或格式不对返回 null。
 */
export function loadMemoryVectors(path = MEMORY_VECTORS_PATH) {
  let raw
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
  if (!Array.isArray(raw?.memories) || !Array.isArray(raw?.queries)) return null
  const identity = { providerHash: raw.providerHash, model: raw.model, dimensions: raw.dimensions, ruleVersion: raw.ruleVersion }
  const byId = (rows) => new Map(rows.map(({ id, textHash, vector }) => [id, { textHash, vector }]))
  return { identity, memories: byId(raw.memories), queries: byId(raw.queries) }
}

const fresh = (entry, text) => (entry && entry.textHash === textHashOf(text) ? entry.vector : null)

/**
 * 聊天时这位用户的记忆列表：和 contextSources 一样，每条带上派生索引里的向量（semantic）。
 * 没有夹具时 semantic 为 null。
 */
export function memoriesWithVectors(set, vectors = null) {
  const key = vectors ? identityKeyOf(vectors.identity, 'memory') : null
  return set.memories.map((memory) => {
    const vector = vectors && fresh(vectors.memories.get(memory.id), memory.content)
    return { ...memory, semantic: vector ? { identityKey: key, version: contentVersion(memory.content), vector } : null }
  })
}

/** 这一句的查询向量：夹具里有、句子也没改过才给，否则 null（这一句只看关键词）。 */
export function queryVectorFor(item, vectors) {
  const vector = vectors && fresh(vectors.queries.get(item.id), item.text)
  return vector ? { ...vectors.identity, vector } : null
}

/**
 * 这一句带进来的记忆 id（最多 5 条，按聊天时的排序）。vectors 为 null 时只看关键词与标签。
 * minScore、corroborate 不给就和聊天时一样（见 retrieveRelevantMemories）。
 */
export function predictMemories(item, memories, { vectors = null, minScore, corroborate } = {}) {
  const options = Object.fromEntries(Object.entries({ minScore, corroborate }).filter(([, value]) => value !== undefined))
  return retrieveRelevantMemories(item.text, memories, queryVectorFor(item, vectors), options).map((memory) => memory.id)
}

const ratio = (part, whole) => (whole ? part / whole : null)

/**
 * 召回（该带的带了几条）、多带（既不在 expect 也不在 allow 的）、按类别汇总，以及逐句的错漏。
 * noisyCases：带了无关记忆的句数——「不该带记忆」这一类就是误带的句数。
 */
export function scoreMemoryRetrieval(cases, predict) {
  const tally = () => ({ cases: 0, expected: 0, retrieved: 0, hits: 0, noise: 0, allFound: 0, noisyCases: 0 })
  const overall = tally()
  const byKind = Object.fromEntries(Object.keys(MEMORY_KINDS).map((kind) => [kind, tally()]))
  const details = []
  for (const item of cases) {
    const got = predict(item)
    const hits = got.filter((id) => item.expect.includes(id))
    const noise = got.filter((id) => !item.expect.includes(id) && !item.allow.includes(id))
    for (const bucket of [overall, byKind[item.kind]]) {
      bucket.cases += 1
      bucket.expected += item.expect.length
      bucket.retrieved += got.length
      bucket.hits += hits.length
      bucket.noise += noise.length
      bucket.allFound += hits.length === item.expect.length ? 1 : 0
      bucket.noisyCases += noise.length ? 1 : 0
    }
    details.push({ id: item.id, kind: item.kind, expect: item.expect, got, missed: item.expect.filter((id) => !got.includes(id)), noise })
  }
  const finish = (bucket) => ({ ...bucket, recall: ratio(bucket.hits, bucket.expected) })
  return {
    overall: finish(overall),
    byKind: Object.fromEntries(Object.entries(byKind).map(([kind, bucket]) => [kind, finish(bucket)])),
    details,
    mistakes: details.filter((row) => row.missed.length || row.noise.length),
  }
}

/**
 * 多带的记忆里，有几条是向量带进来的：同一句只看关键词时没带、加上向量才带的。
 * 阈值管得了的只有这一部分；关键词与标签撞车带进来的，阈值调多高也还在。
 */
export function noiseFromVectors(withVectors, keywordOnly) {
  const before = new Map(keywordOnly.details.map((row) => [row.id, new Set(row.noise)]))
  return withVectors.details.reduce((sum, row) => sum + row.noise.filter((id) => !before.get(row.id)?.has(id)).length, 0)
}
