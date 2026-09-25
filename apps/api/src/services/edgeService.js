/**
 * 记忆之间的关系（路线图 C23）：写信前的回想顺带让她从你的记忆里自己找关系——相似、相关、矛盾。
 *
 * - 关系是她的组织层（inferences，kind=relation），不是你确认的事实：聊天时作为「她自己的联想」一跳带出，
 *   写信时是「合并两条」「标出矛盾」建议的依据；两端任一条根被改就作废，被删就一起删。
 * - 这是非对称记忆架构里「她自行组织」的一环：你管根，她来整理，信里提议。
 * - 失败由调用方降级，绝不拖垮理解的整理与记忆的增删改。
 * - 日志只记 userId/requestId/计数，不记记忆内容与关系明细。
 */
import prisma from '../prisma/client.js'
import logger from '../utils/logger.js'
import { assertCloudCallable, getGateway } from './llmService.js'
import { withMemoryTransaction } from './memoryGovernance.js'
import { liveMemoryWhere } from './memory/scopes.js'
import { dedupeKeyOf, relationContent, saveInferences } from './memory/inferenceService.js'

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

const BASIS_QUOTE_CHARS = 200

/**
 * 从你的记忆里找关系，存进她的组织层。consent 必传：{ allowExternal, authorizeExternal }。
 * 未同意/未配置抛错（同意门先于一切）；模型无内容或输出不可解析时计零产出。
 */
export async function deriveEdges(userId, requestId, consent) {
  const { allowExternal, authorizeExternal } = consent
  assertCloudCallable(allowExternal)
  const generation = await prisma.user.findUnique({ where: { id: userId }, select: { memoryEpoch: true } })
  const memories = await prisma.memory.findMany({
    where: liveMemoryWhere(userId),
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
    // 找关系期间你改过或删过记忆：靠的是旧说法，整批丢掉
    const current = await tx.user.findUnique({ where: { id: userId }, select: { memoryEpoch: true } })
    if (current?.memoryEpoch !== generation?.memoryEpoch) return { created: 0, skipped: parsed.length }
    const currentMemories = await tx.memory.findMany({
      where: { ...liveMemoryWhere(userId), id: { in: memories.map((memory) => memory.id) } },
      select: { id: true, revision: true },
    })
    const versions = new Map(currentMemories.map((memory) => [memory.id, memory.revision]))

    const items = []
    const seen = new Set()
    let skipped = 0
    for (const item of parsed) {
      const from = memories[(item?.from ?? 0) - 1]
      const to = memories[(item?.to ?? 0) - 1]
      const isValid = from && to
        && from.id !== to.id
        && from.revision === versions.get(from.id) && to.revision === versions.get(to.id)
        && EDGE_RELATIONS.includes(item.relation)
        && EDGE_CONFIDENCES.includes(item.confidence)
      const payload = isValid ? { fromMemoryId: from.id, toMemoryId: to.id, relation: item.relation, confidence: item.confidence } : null
      const key = payload ? dedupeKeyOf({ kind: 'relation', payload }) : ''
      if (!isValid || seen.has(key)) {
        skipped += 1
        continue
      }
      seen.add(key)
      const quotes = Array.isArray(item.evidence)
        ? item.evidence.filter((entry) => typeof entry === 'string').slice(0, MAX_EDGE_EVIDENCE_ITEMS).map((entry) => entry.slice(0, MAX_EDGE_EVIDENCE_CHARS))
        : []
      // 依据是两端的根（带版本）：模型给的片段逐字出自哪一端就用哪句，否则引那条记忆的开头
      const basis = [from, to].map((memory) => {
        const quote = quotes.find((entry) => entry.trim() && memory.content.includes(entry)) ?? memory.content.slice(0, BASIS_QUOTE_CHARS)
        return { type: 'memory', id: memory.id, revision: memory.revision, quote, status: 'verified' }
      })
      items.push({ kind: 'relation', content: relationContent(from.content, to.content, item.relation), payload, basis, basisMemoryIds: [from.id, to.id] })
    }

    const saved = items.length ? await saveInferences(userId, items, { producedBy: `reflection:${new Date().toISOString()}`, database: tx }) : { created: 0 }
    skipped += items.length - saved.created - (saved.revived ?? 0)
    logger.info('记忆关系整理', { userId, requestId, created: saved.created, revived: saved.revived ?? 0, skipped })
    return { created: saved.created, skipped }
  })
}
