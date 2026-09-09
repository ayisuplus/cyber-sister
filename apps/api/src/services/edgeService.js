/**
 * 记忆关系边服务（法典 §8 知识图谱：派生关系边 + 工作台晋升）。
 *
 * - 边由工作台分析自动抽取（status=derived），用户在工作台「关系」页签逐条确认后
 *   晋升 canonical；canonical 边在聊天注入时做一跳联想扩展。
 * - 派生是附加投影：deriveEdges 的失败由调用方降级，绝不拖垮条目分析与记忆 CRUD。
 * - 去重口径与 insight 对齐：只对 derived/canonical 既有边去重；dismissed 是草稿
 *   处理结果不是定论，重建后允许重现。
 * - 日志只记 userId/requestId/计数，不记记忆内容与关系明细。
 */
import prisma from '../prisma/client.js'
import { findOwned, HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'
import { assertCloudCallable, getGateway } from './llmService.js'

export const EDGE_RELATIONS = ['similar', 'related', 'contradicts']
const EDGE_CONFIDENCES = ['low', 'medium', 'high']
const EDGE_MEMORY_LIMIT = 100
const MAX_EDGE_EVIDENCE_ITEMS = 2
const MAX_EDGE_EVIDENCE_CHARS = 200
const EDGE_ANALYSIS_MAX_TOKENS = 1200
const EDGE_LIST_STATUSES = ['derived', 'canonical', 'dismissed', 'all']

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

/** 批量 join 两端记忆内容；任一端记忆缺失的边整条过滤。返回路由出参形态。 */
async function joinEdgeContents(edges) {
  const memoryIds = [...new Set(edges.flatMap((edge) => [edge.fromMemoryId, edge.toMemoryId]))]
  const memories = await prisma.memory.findMany({
    where: { id: { in: memoryIds } },
    select: { id: true, content: true },
  })
  const contentById = new Map(memories.map((memory) => [memory.id, memory.content]))
  return edges
    .filter((edge) => contentById.has(edge.fromMemoryId) && contentById.has(edge.toMemoryId))
    .map((edge) => {
      let evidence = []
      try {
        const parsed = JSON.parse(edge.evidence ?? '[]')
        if (Array.isArray(parsed)) evidence = parsed
      } catch {
        // 畸形 evidence 按空数组出参，不阻断列表
      }
      return {
        id: edge.id,
        relation: edge.relation,
        confidence: edge.confidence,
        status: edge.status,
        evidence,
        from: { id: edge.fromMemoryId, content: contentById.get(edge.fromMemoryId) },
        to: { id: edge.toMemoryId, content: contentById.get(edge.toMemoryId) },
        createdAt: edge.createdAt,
      }
    })
}

/**
 * 从用户记忆派生关系边（status=derived）。consent 必传：{ allowExternal, authorizeExternal }。
 * 未同意/未配置抛错（同意门先于一切）；模型无内容或输出不可解析时计零产出。
 */
export async function deriveEdges(userId, requestId, consent) {
  const { allowExternal, authorizeExternal } = consent
  assertCloudCallable(allowExternal)
  const memories = await prisma.memory.findMany({
    where: { userId },
    orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
    take: EDGE_MEMORY_LIMIT,
    select: { id: true, content: true },
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

  const existingEdges = await prisma.memoryEdge.findMany({
    where: { userId, status: { in: ['derived', 'canonical'] } },
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
    const evidence = Array.isArray(item.evidence)
      ? item.evidence
        .filter((entry) => typeof entry === 'string')
        .slice(0, MAX_EDGE_EVIDENCE_ITEMS)
        .map((entry) => entry.slice(0, MAX_EDGE_EVIDENCE_CHARS))
      : []
    valid.push({
      userId,
      fromMemoryId: from.id,
      toMemoryId: to.id,
      relation: item.relation,
      confidence: item.confidence,
      evidence: JSON.stringify(evidence),
    })
  }

  if (valid.length > 0) {
    await prisma.memoryEdge.createMany({ data: valid })
  }
  logger.info('记忆关系派生', { userId, requestId, created: valid.length, skipped })
  return { created: valid.length, skipped }
}

/** 列出记忆关系边；status 只允许 derived | canonical | dismissed | all。 */
export async function listEdges(userId, { status = 'derived' } = {}) {
  if (!EDGE_LIST_STATUSES.includes(status)) {
    throw new HttpError('status 必须是 derived、canonical、dismissed 或 all', 400)
  }
  const edges = await prisma.memoryEdge.findMany({
    where: { userId, ...(status === 'all' ? {} : { status }) },
    orderBy: { createdAt: 'desc' },
  })
  return joinEdgeContents(edges)
}

/** 确认一条派生关系：derived → canonical；重复确认或已忽略的条目报 400。 */
export async function promoteEdge(userId, id) {
  const edge = await findOwned('memoryEdge', id, userId, '记忆关系')
  if (edge.status === 'canonical') throw new HttpError('该关系已确认', 400)
  if (edge.status === 'dismissed') throw new HttpError('该条目已处理过', 400)
  const updated = await prisma.memoryEdge.update({
    where: { id: edge.id },
    data: { status: 'canonical' },
  })
  logger.info('记忆关系定典', { userId, edgeId: edge.id })
  const [joined] = await joinEdgeContents([updated])
  return joined ?? null
}

/** 忽略一条记忆关系（非本人条目抛 404）。 */
export async function dismissEdge(userId, id) {
  const edge = await findOwned('memoryEdge', id, userId, '记忆关系')
  await prisma.memoryEdge.update({
    where: { id: edge.id },
    data: { status: 'dismissed' },
  })
  logger.info('记忆关系忽略', { userId, edgeId: edge.id })
}

/** 清掉未定典的关系草稿（derived/dismissed）；canonical 保留为定典历史。 */
export async function clearDerivedEdges(userId) {
  const result = await prisma.memoryEdge.deleteMany({
    where: { userId, status: { in: ['derived', 'dismissed'] } },
  })
  return result.count
}
