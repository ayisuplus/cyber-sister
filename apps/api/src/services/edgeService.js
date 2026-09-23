/**
 * 记忆关系边服务（法典 §8 知识图谱）：写信前的回想顺带从记忆里派生关系草稿（status=derived）。
 *
 * - 边是附加投影：deriveEdges 的失败由调用方降级，绝不拖垮条目分析与记忆 CRUD。
 * - 生成结果提交前重新核对依据版本；已有确认或重审记录不会被后台覆盖。
 * - 日志只记 userId/requestId/计数，不记记忆内容与关系明细。
 */
import prisma from '../prisma/client.js'
import logger from '../utils/logger.js'
import { assertCloudCallable, getGateway } from './llmService.js'
import { withMemoryTransaction } from './memoryGovernance.js'

export const EDGE_RELATIONS = ['similar', 'related', 'contradicts']
const EDGE_CONFIDENCES = ['low', 'medium', 'high']
const EDGE_MEMORY_LIMIT = 100
const MAX_EDGE_EVIDENCE_ITEMS = 2
const MAX_EDGE_EVIDENCE_CHARS = 200
const EDGE_ANALYSIS_MAX_TOKENS = 1200

/** 与 derivedService 同源同款实现：提取首个 JSON 数组，失败返回 null。 */
function extractJsonArray(output) {
  const text = String(output ?? '')
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(text.slice(start, end + 1))
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function buildEdgePrompt(memories) {
  const memoryLines = memories
    .map((memory, index) => `${index + 1}. ${String(memory.content).slice(0, 120)}`)
    .join('\n')
  return `以下是用户已确认的记忆列表：
"""
${memoryLines}
"""
找出这些记忆之间明确的关系，只输出 JSON 数组：[{"from": 编号, "to": 编号, "relation": "similar|related|contradicts", "confidence": "low|medium|high", "evidence": ["支撑片段"]}]；没有关系就输出 []；最多 10 条；不要输出任何解释。`
}

/** 边去重键：无向记忆对 + 关系。 */
const edgeKey = (fromId, toId, relation) => [fromId, toId].sort().join(':') + ':' + relation

/**
 * 从用户记忆派生关系边（status=derived）。consent 必传：{ allowExternal, authorizeExternal }。
 * 未同意/未配置抛错（同意门先于一切）；模型无内容或输出不可解析时计零产出。
 */
export async function deriveEdges(userId, requestId, consent) {
  const { allowExternal, authorizeExternal } = consent
  assertCloudCallable(allowExternal)
  const generation = await prisma.user.findUnique({ where: { id: userId }, select: { memoryEpoch: true } })
  const memories = await prisma.memory.findMany({
    where: { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
    take: EDGE_MEMORY_LIMIT,
    select: { id: true, content: true, revision: true },
  })
  if (memories.length < 2) return { created: 0, skipped: 0 }

  const gateway = await getGateway()
  const result = await gateway.complete({
    scene: 'explain',
    requestId,
    messages: [{ role: 'user', content: buildEdgePrompt(memories) }],
    allowExternal,
    authorizeExternal,
    timeoutMs: 60000,
    maxTokens: EDGE_ANALYSIS_MAX_TOKENS,
    temperature: 0.3,
  })
  if (!result?.content) return { created: 0, skipped: 0 }
  const parsed = extractJsonArray(result.content)
  if (!parsed) return { created: 0, skipped: 0 }

  return withMemoryTransaction(userId, async (tx) => {
  const current = await tx.user.findUnique({ where: { id: userId }, select: { memoryEpoch: true } })
  if (current?.memoryEpoch !== generation?.memoryEpoch) return { created: 0, skipped: parsed.length }
  const currentMemories = await tx.memory.findMany({ where: { userId, id: { in: memories.map((memory) => memory.id) },
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { id: true, revision: true } })
  const versions = new Map(currentMemories.map((memory) => [memory.id, memory.revision]))
  const existingEdges = await tx.memoryEdge.findMany({
    where: { userId, OR: [{ status: { in: ['derived', 'canonical', 'needs_review'] } }, { NOT: { decisions: { equals: [] } } }] },
    select: { fromMemoryId: true, toMemoryId: true, relation: true },
  })
  const knownKeys = new Set(
    existingEdges.map((edge) => edgeKey(edge.fromMemoryId, edge.toMemoryId, edge.relation)),
  )

  const valid = []
  let skipped = 0
  for (const item of parsed) {
    const from = memories[(item?.from ?? 0) - 1]
    const to = memories[(item?.to ?? 0) - 1]
    const isValid = from && to
      && from.id !== to.id
      && from.revision === versions.get(from.id) && to.revision === versions.get(to.id)
      && EDGE_RELATIONS.includes(item.relation)
      && EDGE_CONFIDENCES.includes(item.confidence)
    if (!isValid) {
      skipped += 1
      continue
    }
    const key = edgeKey(from.id, to.id, item.relation)
    if (knownKeys.has(key)) {
      skipped += 1
      continue
    }
    knownKeys.add(key)
    const quotes = Array.isArray(item.evidence)
      ? item.evidence
        .filter((entry) => typeof entry === 'string')
        .slice(0, MAX_EDGE_EVIDENCE_ITEMS)
        .map((entry) => entry.slice(0, MAX_EDGE_EVIDENCE_CHARS))
      : []
    const evidence = quotes.flatMap((quote) => {
      const source = [from, to].find((memory) => quote.trim() && memory.content.includes(quote))
      return source ? [{ type: 'memory', id: source.id, revision: source.revision, quote }] : []
    })
    valid.push({
      userId,
      fromMemoryId: from.id,
      toMemoryId: to.id,
      fromRevision: from.revision,
      toRevision: to.revision,
      relation: item.relation,
      confidence: item.confidence,
      evidence: JSON.stringify(evidence),
    })
  }

  if (valid.length > 0) {
    await tx.memoryEdge.createMany({ data: valid })
  }
  logger.info('记忆关系派生', { userId, requestId, created: valid.length, skipped })
  return { created: valid.length, skipped }
  })
}
