/**
 * 记忆语义向量投影服务（project_down 的第一种投影）。
 *
 * - 投影可重建：嵌入失败静默降级（记忆照常保存，仅无向量），绝不阻断记忆 CRUD 或聊天。
 * - embedding 永不进入提示词与 API 响应（检索返回前由 llmService 剥离）。
 * - 同意语义与记忆候选/工作台同款：externalLlmConsent === true 且版本匹配 EXTERNAL_LLM_CONSENT_VERSION。
 * - 网关包只支持 chat/completions，无现成 embedding 能力，此处直连供应商 /embeddings。
 * - 日志只记 userId/error，不记记忆内容与向量。
 */
import prisma from '../prisma/client.js'
import { isCloudProviderConfigured, assertCloudCallable } from './llmService.js'
import { EXTERNAL_LLM_CONSENT_VERSION } from './userService.js'
import logger from '../utils/logger.js'

const EMBEDDING_TIMEOUT_MS = 15000

export function embeddingModelName() {
  return process.env.GATEWAY_QWEN_EMBEDDING_MODEL || 'text-embedding-v4'
}

/** 单文本嵌入：供应商未配置或任何失败返回 null，永不抛出；自身不含同意门。 */
export async function embedText(text) {
  if (!isCloudProviderConfigured()) return null
  try {
    const response = await fetch(`${process.env.GATEWAY_QWEN_BASE_URL}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GATEWAY_QWEN_API_KEY}`,
      },
      body: JSON.stringify({ model: embeddingModelName(), input: String(text ?? '') }),
      signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const body = await response.json()
    const embedding = body?.data?.[0]?.embedding
    if (!Array.isArray(embedding) || embedding.length === 0) return null
    if (!embedding.every((value) => typeof value === 'number' && Number.isFinite(value))) return null
    return embedding
  } catch {
    return null
  }
}

/** 与 derivedService/memorySuggestionService 同款的同意读法（内联重复，不抽公共函数）。 */
async function loadConsent(userId) {
  const consent = await prisma.user.findUnique({
    where: { id: userId },
    select: { externalLlmConsent: true, externalLlmConsentVersion: true },
  })
  return consent?.externalLlmConsent === true
    && consent.externalLlmConsentVersion === EXTERNAL_LLM_CONSENT_VERSION
}

/** 检索查询向量：未同意直接 null（调用方回退关键词路径）。 */
export async function embedQuery(text, allowExternal) {
  if (!allowExternal) return null
  return embedText(text)
}

/** 单条记忆投影：未同意/未配置/失败均返回 false，永不抛出。 */
export async function embedMemory(memory) {
  try {
    if (!isCloudProviderConfigured()) return false
    if (!await loadConsent(memory.userId)) return false
    const vector = await embedText(memory.content)
    if (!vector) {
      logger.warn('记忆向量投影失败', { userId: memory.userId })
      return false
    }
    await prisma.memory.update({
      where: { id: memory.id },
      data: { embedding: vector, embeddingModel: embeddingModelName() },
    })
    return true
  } catch (error) {
    logger.warn('记忆向量投影失败', { userId: memory.userId, error: error.message })
    return false
  }
}

/**
 * 全量重建该用户的记忆向量：已有向量的计 skipped，其余逐条串行投影。
 * 同意门先于一切：未同意抛 CloudConsentRequiredError、未配置抛 LlmUnavailableError，一行不写。
 */
export async function rebuildEmbeddings(userId) {
  const allowExternal = await loadConsent(userId)
  assertCloudCallable(allowExternal)
  const memories = await prisma.memory.findMany({
    where: { userId },
    select: { id: true, content: true, embedding: true },
  })
  let embedded = 0
  let failed = 0
  let skipped = 0
  for (const memory of memories) {
    if (memory.embedding?.length > 0) {
      skipped += 1
      continue
    }
    // 逐条串行投影：供应商限流下并行只会放大失败面
    // eslint-disable-next-line no-await-in-loop
    if (await embedMemory(memory)) embedded += 1
    else failed += 1
  }
  return { embedded, failed, skipped }
}
