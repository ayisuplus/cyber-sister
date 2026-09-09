/**
 * 她的工作台（派生理解层）服务。
 *
 * AI 在对话后自由生成对用户的理解（模式/假设/冲突/小结），存入独立的派生层：
 * - 派生层永远不是记忆：可见、可审、可整层清空；用户批准的内容经 promoteInsight
 *   晋升进显式记忆（复用 memoryService.createMemory 的唯一校验权威）。
 * - 生成走与记忆候选同款的云端同意门：未同意不得调用云端模型；自动入口绝不抛出。
 * - 危机消息不进入分析输入；候选命中敏感正则即丢弃。
 * - 日志只记 userId/requestId/created/skipped，不记内容。
 */
import prisma from '../prisma/client.js'
import { findOwned, HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'
import { detectCrisis } from './detection.js'
import { createMemory } from './memoryService.js'
import { LlmUnavailableError, assertCloudCallable, getGateway } from './llmService.js'
import { deriveEdges, clearDerivedEdges } from './edgeService.js'
import { EXTERNAL_LLM_CONSENT_VERSION } from './userService.js'
import {
  REDACTION_PLACEHOLDER_PATTERN,
  SENSITIVE_LOCATION_PATTERNS,
  SENSITIVE_MEDICAL_PATTERNS,
} from '../utils/sensitivePatterns.js'

export const INSIGHT_KINDS = ['pattern', 'hypothesis', 'conflict', 'summary']
const INSIGHT_CONFIDENCES = ['low', 'medium', 'high']
const INSIGHT_STATUSES = ['active', 'promoted', 'dismissed', 'resolved']

const MAX_CONTENT_CHARS = 200
const MAX_EVIDENCE_ITEMS = 2
const MAX_EVIDENCE_CHARS = 200
const RECENT_MESSAGE_LIMIT = 20
const MEMORY_CONTEXT_LIMIT = 20
// 自动分析成本阈值：自最新一条 insight 起算的新消息数达到该值才生成
const AUTO_ANALYSIS_MIN_NEW_MESSAGES = 6
const ANALYSIS_TIMEOUT_MS = 60000
const MAX_ANALYSIS_TOKENS = 1500
const ANALYSIS_TEMPERATURE = 0.3

/** 与 importService 同口径的规范化去重键：NFKC + trim + 小写。 */
const normalizeKey = (text) => String(text ?? '').normalize('NFKC').trim().toLowerCase()

/** 与 memorySuggestionService 同款解析口径：提取首个 JSON 数组，失败返回 null。 */
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

function buildAnalysisPrompt(messages, memories) {
  const messageLines = messages.map((message) => `${message.role}: ${message.content}`).join('\n')
  const memoryLines = memories.map((memory) => memory.content).join('\n')
  return `你是「她」的工作台助手。基于最近的对话与已确认的用户记忆，生成对这位用户的理解，最多 3 条。
要求：
- 只输出一个 JSON 数组，不要输出任何其他文字；没有值得记录的理解就输出 []。
- 每项格式：{"kind":"pattern|hypothesis|conflict|summary","content":"...","confidence":"low|medium|high","evidence":["支撑这句话的对话片段原文，不超过 2 条"]}
- kind 含义：pattern=反复出现的模式或习惯，hypothesis=推测但待确认，conflict=与已有记忆或先前说法冲突，summary=近期状态小结。
- content 不超过 60 字，用第三人称（"她"）描述用户；不得包含联系方式、证件号、精确地址或医疗细节。
- 这些是工作台草稿，不是事实；拿不准就标 hypothesis + low。
最近对话：
"""
${messageLines}
"""
已确认的记忆：
"""
${memoryLines}
"""`
}

/** 校验并规范化单个候选；字段越界返回 null（调用方计入 skipped）。 */
function normalizeCandidate(item) {
  if (!item || typeof item !== 'object') return null
  if (!INSIGHT_KINDS.includes(item.kind)) return null
  if (!INSIGHT_CONFIDENCES.includes(item.confidence)) return null
  const content = typeof item.content === 'string' ? item.content.trim() : ''
  if (content.length === 0 || content.length > MAX_CONTENT_CHARS) return null
  let evidence = []
  if (
    Array.isArray(item.evidence)
    && item.evidence.length <= MAX_EVIDENCE_ITEMS
    && item.evidence.every((entry) => typeof entry === 'string' && entry.length <= MAX_EVIDENCE_CHARS)
  ) {
    evidence = item.evidence
  }
  return { kind: item.kind, confidence: item.confidence, content, evidence }
}

/** 候选侧敏感排除：命中联系方式/证件号占位符、精确位置或医疗内容即丢弃。 */
function isSensitiveContent(content) {
  return REDACTION_PLACEHOLDER_PATTERN.test(content)
    || SENSITIVE_LOCATION_PATTERNS.some((pattern) => pattern.test(content))
    || SENSITIVE_MEDICAL_PATTERNS.some((pattern) => pattern.test(content))
}

/** 与记忆候选同款的同意装配：allowExternal + authorizeExternal 动态复查。 */
async function loadConsent(userId) {
  const consent = await prisma.user.findUnique({
    where: { id: userId },
    select: { externalLlmConsent: true, externalLlmConsentVersion: true },
  })
  const allowExternal = consent?.externalLlmConsent === true
    && consent.externalLlmConsentVersion === EXTERNAL_LLM_CONSENT_VERSION
  let authorizeExternal
  if (allowExternal) {
    authorizeExternal = async () => {
      const current = await prisma.user.findUnique({
        where: { id: userId },
        select: { externalLlmConsent: true, externalLlmConsentVersion: true },
      })
      return current?.externalLlmConsent === true
        && current.externalLlmConsentVersion === EXTERNAL_LLM_CONSENT_VERSION
    }
  }
  return { allowExternal, authorizeExternal }
}

/** 逐条校验、敏感排除、与 active 既有条目双向规范化去重。 */
async function selectValidCandidates(userId, items) {
  let skipped = 0
  const candidates = []
  for (const item of items) {
    const candidate = normalizeCandidate(item)
    if (!candidate || isSensitiveContent(candidate.content)) {
      skipped += 1
      continue
    }
    candidates.push(candidate)
  }
  const existing = await prisma.derivedInsight.findMany({
    where: { userId, status: 'active' },
    select: { content: true },
  })
  const seen = new Set(existing.map((record) => normalizeKey(record.content)))
  const valid = []
  for (const candidate of candidates) {
    const key = normalizeKey(candidate.content)
    if (seen.has(key)) {
      skipped += 1
      continue
    }
    seen.add(key)
    valid.push(candidate)
  }
  return { valid, skipped }
}

async function runAnalysis(userId, requestId, { manual, consent } = {}) {
  const { allowExternal, authorizeExternal } = consent ?? (await loadConsent(userId))
  // 工作台生成同样走同意门：未同意不得调用云端模型
  assertCloudCallable(allowExternal)
  const [recentMessages, memories] = await Promise.all([
    prisma.message.findMany({
      where: { conversation: { userId } },
      orderBy: { createdAt: 'desc' },
      take: RECENT_MESSAGE_LIMIT,
      select: { role: true, content: true },
    }),
    prisma.memory.findMany({
      where: { userId },
      orderBy: { importance: 'desc' },
      take: MEMORY_CONTEXT_LIMIT,
      select: { content: true },
    }),
  ])
  // 旧到新排列；危机消息不进入分析输入
  const messages = recentMessages.reverse().filter((message) => !detectCrisis(message.content))
  const gateway = await getGateway()
  const result = await gateway.complete({
    scene: 'explain',
    requestId,
    messages: [{ role: 'user', content: buildAnalysisPrompt(messages, memories) }],
    allowExternal,
    authorizeExternal,
    timeoutMs: ANALYSIS_TIMEOUT_MS,
    maxTokens: MAX_ANALYSIS_TOKENS,
    temperature: ANALYSIS_TEMPERATURE,
  })
  if (!result?.content) {
    if (manual) throw new LlmUnavailableError()
    return { created: 0, skipped: 0 }
  }
  const parsed = extractJsonArray(result.content)
  if (!parsed) return { created: 0, skipped: 0 }
  const { valid, skipped } = await selectValidCandidates(userId, parsed)
  if (valid.length > 0) {
    await prisma.derivedInsight.createMany({
      data: valid.map((candidate) => ({
        userId,
        kind: candidate.kind,
        content: candidate.content,
        evidence: JSON.stringify(candidate.evidence),
        confidence: candidate.confidence,
      })),
    })
  }
  logger.info('工作台分析完成', { userId, requestId, created: valid.length, skipped })
  let edgesCreated = 0
  try {
    edgesCreated = (await deriveEdges(userId, requestId, { allowExternal, authorizeExternal })).created
  } catch (error) {
    // 边派生是附加投影：失败不拖垮条目分析
    logger.warn('记忆关系派生失败', { userId, requestId, error: error.message })
  }
  return { created: valid.length, skipped, edgesCreated }
}

/**
 * 列出台工作台条目；status 只允许 active | promoted | dismissed | resolved | all。
 */
export async function listInsights(userId, { status = 'active' } = {}) {
  if (![...INSIGHT_STATUSES, 'all'].includes(status)) {
    throw new HttpError('status 必须是 active、promoted、dismissed、resolved 或 all', 400)
  }
  return prisma.derivedInsight.findMany({
    where: { userId, ...(status !== 'all' ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * 手动立即分析：未同意抛 CloudConsentRequiredError，网关无内容抛 LlmUnavailableError。
 */
export async function analyzeNow(userId, requestId) {
  return runAnalysis(userId, requestId, { manual: true })
}

/**
 * 自动分析入口（聊天持久化后 fire-and-forget）：绝不抛出。
 * 未同意 → not_consented；自最新一条 insight 后新消息不足阈值 → threshold。
 */
export async function maybeAutoAnalyze(userId, requestId) {
  try {
    const consent = await loadConsent(userId)
    if (!consent.allowExternal) return { skipped: 'not_consented', created: 0 }
    const latest = await prisma.derivedInsight.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    const newMessages = await prisma.message.count({
      where: {
        conversation: { userId },
        ...(latest ? { createdAt: { gt: latest.createdAt } } : {}),
      },
    })
    if (newMessages < AUTO_ANALYSIS_MIN_NEW_MESSAGES) return { skipped: 'threshold', created: 0 }
    return await runAnalysis(userId, requestId, { manual: false, consent })
  } catch (error) {
    logger.warn('工作台自动分析失败', { userId, requestId, error: error.message })
    return { created: 0, skipped: 0 }
  }
}

/**
 * 晋升：把一条工作台条目写进显式记忆（createMemory 为唯一校验权威）。
 * 已有规范化键相同的显式记忆时不重复创建，仅标记晋升。
 */
export async function promoteInsight(userId, id, { type = 'semantic', importance = 5, tags = [] } = {}) {
  const insight = await findOwned('derivedInsight', id, userId, '工作台条目')
  const memories = await prisma.memory.findMany({
    where: { userId },
    select: { id: true, content: true },
  })
  const key = normalizeKey(insight.content)
  const existing = memories.find((memory) => normalizeKey(memory.content) === key)
  let memory
  if (existing) {
    memory = await prisma.memory.findUnique({ where: { id: existing.id } })
    if (memory) {
      // embedding/embeddingModel 是机器投影：不进 API 响应
      delete memory.embedding
      delete memory.embeddingModel
    }
  } else {
    memory = await createMemory(userId, { type, content: insight.content, importance, tags, origin: 'promoted', sourceRef: insight.id })
  }
  const updated = await prisma.derivedInsight.update({
    where: { id: insight.id },
    data: { status: 'promoted', promotedMemoryId: memory.id },
  })
  logger.info('工作台条目晋升', { userId, insightId: insight.id, memoryId: memory.id })
  return { memory, insight: updated }
}

/** 忽略一条工作台条目（非本人条目抛 404）。 */
export async function dismissInsight(userId, id) {
  const insight = await findOwned('derivedInsight', id, userId, '工作台条目')
  await prisma.derivedInsight.update({
    where: { id: insight.id },
    data: { status: 'dismissed' },
  })
  logger.info('工作台条目忽略', { userId, insightId: insight.id })
}

/** 整层清空工作台，返回删除数。 */
export async function clearInsights(userId) {
  const result = await prisma.derivedInsight.deleteMany({ where: { userId } })
  logger.info('清空工作台', { userId, cleared: result.count })
  return result.count
}

/**
 * 厘清一条冲突条目：用户定稿文案入定典层（origin=promoted），条目转入 resolved 并留存定稿。
 * 与晋升同款规范化键去重：已有相同显式记忆时不重复创建。
 */
export async function resolveInsight(userId, id, { content, type = 'semantic', importance = 5, tags = [] } = {}) {
  const insight = await findOwned('derivedInsight', id, userId, '工作台条目')
  if (insight.kind !== 'conflict') throw new HttpError('只有冲突条目需要厘清', 400)
  if (insight.status !== 'active') throw new HttpError('该条目已处理过', 400)
  const memories = await prisma.memory.findMany({
    where: { userId },
    select: { id: true, content: true },
  })
  const key = normalizeKey(content)
  const existing = memories.find((memory) => normalizeKey(memory.content) === key)
  let memory
  if (existing) {
    memory = await prisma.memory.findUnique({ where: { id: existing.id } })
    if (memory) {
      // embedding/embeddingModel 是机器投影：不进 API 响应
      delete memory.embedding
      delete memory.embeddingModel
    }
  } else {
    memory = await createMemory(userId, { type, content, importance, tags, origin: 'promoted', sourceRef: insight.id })
  }
  const updated = await prisma.derivedInsight.update({
    where: { id: insight.id },
    data: { status: 'resolved', resolution: memory.content, promotedMemoryId: memory.id },
  })
  logger.info('工作台冲突厘清', { userId, insightId: insight.id, memoryId: memory.id })
  return { memory, insight: updated }
}

/**
 * 重建工作台：清掉未定典草稿（active/dismissed），立即重新分析。
 * promoted/resolved 保留为定典历史；未同意先抛 CloudConsentRequiredError，不删任何行。
 */
export async function rebuildInsights(userId, requestId) {
  const consent = await loadConsent(userId)
  assertCloudCallable(consent.allowExternal)
  const { count } = await prisma.derivedInsight.deleteMany({
    where: { userId, status: { in: ['active', 'dismissed'] } },
  })
  const edgesCleared = await clearDerivedEdges(userId)
  const analysis = await runAnalysis(userId, requestId, { manual: true, consent })
  logger.info('重建工作台', { userId, requestId, cleared: count, edgesCleared, created: analysis.created })
  return { cleared: count, edgesCleared, ...analysis }
}
