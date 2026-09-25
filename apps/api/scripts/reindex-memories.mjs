#!/usr/bin/env node
/**
 * 给还没有向量（或向量是别的模型算的、正文改过的）的记忆和她上传的书的段落补算向量：
 *
 *   pnpm --filter cyber-sister-server memories:reindex
 *
 * 向量都在派生索引 embeddings（路线图 C23）。和补算任务走同一条路径（createIndexJob + runIndexJob），
 * 只补缺的，不重算已经对得上的。
 * 只处理同意了当前版本云端处理的用户；没同意的只报人数、不动，她在 App 里重新同意之后再跑一次（或重新一键启动）。
 * 不打印任何记忆内容。一键启动（pnpm start:local）在向量服务起来之后会跑一次。
 */
import 'dotenv/config'
import { loadRuntimeSecrets } from '../src/config/runtime.js'

loadRuntimeSecrets()
const { default: prisma } = await import('../src/prisma/client.js')
const { embeddingConfig } = await import('../src/services/embeddingConfig.js')
const { identityKeyOf } = await import('../src/services/vectors/identity.js')
const { vectorFits } = await import('../src/services/vectors/vectorStore.js')
const { passageEmbeddingText } = await import('../src/services/bookIndexService.js')
const { hasEmbeddingConsent } = await import('../src/services/embeddingService.js')
const { createIndexJob, getIndexJob, runIndexJob } = await import('../src/services/memoryIndexService.js')

const WAIT_MS = 120_000
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

/** 任务可能已被 API 的后台轮询领走：这里等它跑完再报数。 */
async function settle(userId, id) {
  const deadline = Date.now() + WAIT_MS
  for (;;) {
    const job = await getIndexJob(userId, id)
    if (!['queued', 'running'].includes(job.status) || Date.now() > deadline) return job
    await sleep(500)
  }
}

try {
  const config = embeddingConfig()
  if (!config) {
    console.log('[记忆向量] 没配置向量模型（MEMORY_EMBEDDING_*），记忆只用关键词检索，不用补')
    process.exit(0)
  }
  const memories = await prisma.memory.findMany({
    where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    select: { id: true, userId: true, content: true },
  })
  const passages = await prisma.bookPassage.findMany({
    where: { book: { serverIndex: 'ready' } },
    select: { id: true, userId: true, chapter: true, content: true },
  })
  // 这个模型下已有的向量：只看身份键与版本，不读向量本身
  const stored = new Map((await prisma.embedding.findMany({
    where: { identityKey: { in: [identityKeyOf(config, 'memory'), identityKeyOf(config, 'passage')] } },
    select: { subjectType: true, subjectId: true, identityKey: true, subjectVersion: true },
  })).map((row) => [`${row.subjectType}:${row.subjectId}`, { identityKey: row.identityKey, version: row.subjectVersion }]))
  const missing = new Map()
  const count = (userId) => missing.set(userId, (missing.get(userId) ?? 0) + 1)
  for (const memory of memories) {
    if (!vectorFits(stored.get(`memory:${memory.id}`), identityKeyOf(config, 'memory'), memory.content)) count(memory.userId)
  }
  let passagesMissing = 0
  for (const passage of passages) {
    if (!vectorFits(stored.get(`passage:${passage.id}`), identityKeyOf(config, 'passage'), passageEmbeddingText(passage))) {
      count(passage.userId)
      passagesMissing += 1
    }
  }
  let embedded = 0
  let failed = 0
  let users = 0
  let waitingConsent = 0
  for (const [userId, count] of missing) {
    if (!await hasEmbeddingConsent(userId)) {
      waitingConsent += 1
      continue
    }
    const job = await createIndexJob(userId, { mode: 'repair' })
    await runIndexJob(job.id)
    const done = await settle(userId, job.id)
    users += 1
    embedded += done.embedded
    // 任务没跑完（中途失败或等超时）时，剩下没处理的也算没算成
    const unfinished = done.status === 'completed' ? 0 : Math.max(0, count - done.embedded - done.failed)
    failed += done.failed + unfinished
  }
  const total = memories.length + passages.length
  console.log(`[记忆向量] ${config.model}：${memories.length} 条记忆、${passages.length} 段书，共 ${total - [...missing.values()].reduce((a, b) => a + b, 0)} 条已有向量`
    + `${passagesMissing ? `（其中 ${passagesMissing} 段书缺向量）` : ''}`
    + `；这次给 ${users} 位用户补算 ${embedded} 条${failed ? `，${failed} 条没算成（向量服务没起来？）` : ''}`
    + `${waitingConsent ? `；${waitingConsent} 位用户还没同意当前版本的云端处理，她在 App 里重新同意后再跑一次` : ''}`)
  process.exitCode = failed ? 1 : 0
} finally {
  await prisma.$disconnect()
}
