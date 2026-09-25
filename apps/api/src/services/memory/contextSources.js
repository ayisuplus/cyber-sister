/**
 * 读取闸口（路线图 C23，见 docs/architecture/非对称记忆架构.md）：
 * 模型能看到的「关于她」的东西只从这里取。每个来源写明它在哪一层、给谁用、要哪些同意、上限与标注；
 * 同意、过期与敏感类别只在这里判断一次，不再散在聊天、便签、回想和写信各自的取数里。
 * 怎么把这些写给模型看，仍由 contextBlocks.js 与 llmService.buildMemoryContext 负责。
 */
import prisma from '../../prisma/client.js'
import { describeRecentNudges } from '../nudgeService.js'
import { loadCompanionInputs } from '../companionService.js'
import { artifactMetadataFields } from '../workArtifactService.js'
import { liveMemoryWhere } from './scopes.js'

/** 聊天历史原样带多少条；更早的并进前情摘要。 */
export const HISTORY_MESSAGES = 19

/**
 * 来源表：层级 root = 她确认的记忆（根）；organization = 她自己整理的；record = 生活记录。
 * consent 里 cloud = 云端模型同意，periodTone = 「记录经期」与「聊天时顾及周期」两项都开着。
 * 这张表同时是文档：测试断言代码与它一致。
 */
export const CONTEXT_SOURCES = Object.freeze({
  pinnedMemories: { layer: 'root', purposes: ['chat'], consent: ['cloud'], cap: '最多 5 条，未过期', label: '【关于她】她希望你一直记着' },
  relevantMemories: { layer: 'root', purposes: ['chat', 'reflection', 'letter'], consent: ['cloud'], cap: '相关的最多 5 条，未过期', label: '【不可信用户记忆数据】' },
  memoryRelations: { layer: 'organization', purposes: ['chat'], consent: ['cloud'], cap: '每条根最多 2 条', label: '一跳联想' },
  summary: { layer: 'organization', purposes: ['chat'], consent: ['cloud'], cap: '1200 字', label: '【前情摘要】以用户当前陈述为准' },
  recentNudges: { layer: 'organization', purposes: ['chat'], consent: ['cloud'], sensitive: { period: ['periodTone'] }, cap: '主动说的至多 3 条；信只在今天写的、还没读或今天读的才算', label: '【你今天主动对她说过】' },
  companionInputs: { layer: 'record', purposes: ['chat'], consent: ['cloud'], sensitive: { period: ['periodTone'] }, cap: '最近两天的手记心情；经期只给阶段', label: '只调分寸，不写原文' },
  history: { layer: 'record', purposes: ['chat'], consent: ['cloud'], cap: `最近 ${HISTORY_MESSAGES} 条`, label: '对话历史' },
})

export { liveMemoryWhere }

/** 某条内容带着敏感类别时，来源表里登记的同意都得在才让模型看到。 */
export function allowedSensitive(sourceId, sensitive, consents) {
  if (!sensitive) return true
  const needs = CONTEXT_SOURCES[sourceId]?.sensitive?.[sensitive]
  // 表里没登记的敏感类别一律不给：默认站在不给这边
  if (!needs) return false
  return needs.every((consent) => (consent === 'periodTone' ? consents?.period?.tone === true : false))
}

/**
 * 「你今天主动对她说过」：对话末尾那几条她可能正在回应的话。
 * 经期卡片只有两项经期同意都开着才交给模型；对话末尾的便签照常显示（那是给她看的，不给模型）。
 */
export async function loadRecentNudges(userId, consents, now = new Date()) {
  const items = await describeRecentNudges(userId, now)
  return items.filter((item) => allowedSensitive('recentNudges', item.sensitive, consents))
}

/**
 * 聊天这一轮要读的全部来源。memories 是全部未过期的记忆（检索在 llmService 里做），
 * pinned 另行每轮都带；关系只取两端都还在、版本都对得上的。
 */
export async function loadChatSources({ userId, user, consents, conversationId, now = new Date() }) {
  const [descendingHistory, allMemories, canonicalEdges, recentNudges, companionInputs] = await Promise.all([
    // 数据库按倒序只取最近几条，调用方再恢复成旧到新；当前消息由 llmService 追加一次
    prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_MESSAGES,
      select: { role: true, content: true, createdAt: true, workArtifacts: { select: artifactMetadataFields } },
    }),
    prisma.memory.findMany({
      where: liveMemoryWhere(userId, now),
      orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
      select: { id: true, revision: true, content: true, type: true, importance: true, tags: true, pinned: true, projection: true, sources: true },
    }),
    prisma.memoryEdge.findMany({
      where: { userId, status: 'canonical' },
      select: { fromMemoryId: true, toMemoryId: true, fromRevision: true, toRevision: true, relation: true },
    }),
    loadRecentNudges(userId, consents, now),
    // 这一轮分寸要用的：最近的手记心情，以及（两项经期同意都开时）是否在经期
    loadCompanionInputs(userId, user, now),
  ])
  // 放在心上的每轮都在「关于她」里；其余的聊到才想起，不重复出现在相关记忆里
  const pinned = allMemories.filter((memory) => memory.pinned)
  const memories = allMemories.filter((memory) => !memory.pinned)

  // 一跳联想：边 join 上记忆内容；边引用已过期或版本对不上的记忆即丢弃
  const byId = new Map(allMemories.map((memory) => [memory.id, memory]))
  const memoryEdges = []
  for (const edge of canonicalEdges) {
    const from = byId.get(edge.fromMemoryId)
    const to = byId.get(edge.toMemoryId)
    if (!from || !to || from.revision !== edge.fromRevision || to.revision !== edge.toRevision) continue
    memoryEdges.push({ fromMemoryId: edge.fromMemoryId, toMemoryId: edge.toMemoryId, fromContent: from.content, toContent: to.content, relation: edge.relation })
  }
  return { descendingHistory, pinned, memories, memoryEdges, recentNudges, companionInputs }
}
