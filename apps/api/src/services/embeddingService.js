import { redactSensitiveText } from './llmService.js'
import { hasCloudConsent } from './consents.js'
import { withMemoryTransaction } from './memoryGovernance.js'
import { embeddingConfig } from './embeddingConfig.js'
import logger from '../utils/logger.js'

export function embeddingModelName() { return embeddingConfig()?.model ?? null }

// 向量（即使在本机算）同样要云端模型同意 v4：同意说明里写明覆盖记忆向量（路线图 C23 待裁定项之一）
export const hasEmbeddingConsent = hasCloudConsent

/** 仅使用显式配置的向量能力；调用方负责用户授权。 */
export async function embedText(text, { signal, config = embeddingConfig() } = {}) {
  if (!config || signal?.aborted) return null
  try {
    const timeout = AbortSignal.timeout(15000)
    const response = await fetch(`${config.provider}/embeddings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, input: redactSensitiveText(text) }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (!response.ok || signal?.aborted) return null
    const body = await response.json()
    const vector = body?.data?.[0]?.embedding
    if (!validVector(vector, config) || (body.model && body.model !== config.model)) return null
    return vector
  } catch { return null }
}

const validVector = (vector, config) => Array.isArray(vector) && vector.length === config.dimensions
  && vector.every(Number.isFinite) && vector.some((value) => value !== 0)

/**
 * 一次算一批（她上传的书切成的段）：顺序与 texts 一致，有一条不合格整批作废返回 null。
 * 本机向量服务一批最多 64 条；书的段落长，给的时间也比单句长。调用方负责用户授权。
 */
export async function embedTexts(texts, { signal, config = embeddingConfig(), timeoutMs = 120000 } = {}) {
  if (!config || signal?.aborted || !Array.isArray(texts) || !texts.length) return null
  try {
    const timeout = AbortSignal.timeout(timeoutMs)
    const response = await fetch(`${config.provider}/embeddings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, input: texts.map((text) => redactSensitiveText(text)) }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (!response.ok || signal?.aborted) return null
    return vectorsFrom(await response.json(), texts.length, config)
  } catch { return null }
}

/** 一批的返回：条数对得上、模型对得上、每条都合格，才按 index 排好返回。 */
function vectorsFrom(body, count, config) {
  if (!Array.isArray(body?.data) || body.data.length !== count || (body.model && body.model !== config.model)) return null
  const vectors = body.data.map((item, position) => ({ at: Number.isInteger(item?.index) ? item.index : position, vector: item?.embedding }))
    .sort((a, b) => a.at - b.at).map(({ vector }) => vector)
  return vectors.every((vector) => validVector(vector, config)) ? vectors : null
}

export async function embedQuery(text, { allowExternal = false, authorizeExternal, signal } = {}) {
  const config = embeddingConfig()
  if (!config || !allowExternal || signal?.aborted || typeof authorizeExternal !== 'function') return null
  try {
    if (await authorizeExternal() !== true || signal?.aborted) return null
    const vector = await embedText(text, { signal, config })
    if (!vector || signal?.aborted || await authorizeExternal() !== true) return null
    const { apiKey: _apiKey, ...identity } = config
    return { ...identity, vector }
  } catch { return null }
}

export async function embedMemory(memory, { signal, jobId } = {}) {
  const config = embeddingConfig()
  if (!config || signal?.aborted) return false
  try {
    if (!await hasEmbeddingConsent(memory.userId)) return false
    const vector = await embedText(memory.content, { signal, config })
    if (!vector || signal?.aborted) return false
    return await withMemoryTransaction(memory.userId, async (tx) => {
      if (signal?.aborted || !await hasEmbeddingConsent(memory.userId, tx)) return false
      if (jobId && !await tx.memoryIndexJob.findFirst({ where: { id: jobId, userId: memory.userId, status: 'running' } })) return false
      const current = await tx.memory.findFirst({ where: { id: memory.id, userId: memory.userId, revision: memory.revision } })
      if (!current || (current.expiresAt && current.expiresAt <= new Date())) return false
      const liveConfig = embeddingConfig()
      if (!liveConfig || liveConfig.provider !== config.provider || liveConfig.model !== config.model
        || liveConfig.dimensions !== config.dimensions || liveConfig.ruleVersion !== config.ruleVersion) return false
      const { apiKey: _apiKey, ...identity } = config
      await tx.memoryProjection.upsert({ where: { memoryId: memory.id },
        create: { memoryId: memory.id, memoryRevision: memory.revision, ...identity, vector },
        update: { memoryRevision: memory.revision, ...identity, vector },
      })
      return true
    })
  } catch (error) {
    logger.warn('记忆投影未保存', { userId: memory.userId, code: error?.code || 'PROJECTION_FAILED' })
    return false
  }
}

// 旧入口转接任务创建，排队不代表完成。
export async function rebuildEmbeddings(userId) {
  const { createIndexJob } = await import('./memoryIndexService.js')
  return createIndexJob(userId, { mode: 'rebuild' })
}
