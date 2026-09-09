/**
 * 按需记忆建议服务（路线图 W3）。
 *
 * 用户在聊天中主动请求“帮我记住”时，从单条用户消息由本地模型抽取候选记忆。
 * 硬约束（Spec §4/§6）：
 * - 仅 llama.cpp 本地模型：complete 固定 allowExternal=false，网关因此确定性跳过
 *   所有 external 供应商，禁止任何 Qwen 回退。
 * - 候选只存在于响应体：本服务绝不写 Memory 表；用户在界面确认后由既有创建接口落库。
 * - 输入命中危机检测、或候选含联系方式/证件号/精确位置/医疗内容时，不生成候选。
 * - 日志只记 requestId 与结果计数，不记消息或候选内容。
 */
import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'
import { detectCrisis } from './detection.js'
import { MEMORY_TYPES } from './memoryService.js'
import {
  LlmUnavailableError,
  assertCloudCallable,
  getGateway,
  MAX_MODEL_MESSAGE_CHARS,
  redactSensitiveText,
} from './llmService.js'
import { EXTERNAL_LLM_CONSENT_VERSION } from './userService.js'
import {
  REDACTION_PLACEHOLDER_PATTERN,
  SENSITIVE_LOCATION_PATTERNS,
  SENSITIVE_MEDICAL_PATTERNS,
} from '../utils/sensitivePatterns.js'

const MAX_CANDIDATES = 2
const SUGGESTION_TIMEOUT_MS = 60000
const MAX_SUGGESTION_TOKENS = 2000
const SUGGESTION_TEMPERATURE = 0.2
const MAX_DEDUP_MEMORIES = 500

// 以下字段上限与 memoryService 创建接口保持一致（该模块未导出这些常量）
const MAX_CONTENT_LENGTH = 2000
const MAX_TAGS = 10
const MAX_TAG_LENGTH = 30

// 敏感排除口径见 utils/sensitivePatterns.js（与她的工作台共用同一份）

function buildExtractionPrompt(text) {
  return [
    '你是记忆抽取助手。从下面这条用户消息中抽取值得长期记住的用户信息，最多 2 条。',
    '要求：',
    '- 只输出一个 JSON 数组，不要输出任何其他文字；没有值得记住的信息就输出 []。',
    '- 每项格式：{"type":"semantic|episodic|procedural","content":"...","importance":1到10的整数,"tags":["..."]}',
    '- type 含义：semantic=事实或偏好，episodic=经历或事件，procedural=习惯或做法。',
    '- content 不超过 50 字，且不得包含联系方式、证件号、精确地址或医疗细节。',
    '用户消息：',
    '"""',
    text,
    '"""',
  ].join('\n')
}

/** 从模型输出中提取首个 JSON 数组；解析失败返回 null（按“无候选”处理，不抛错）。 */
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

/** 规范化候选 tags；越界返回 null（调用方据此丢弃候选）。 */
function normalizeCandidateTags(rawTags) {
  if (!Array.isArray(rawTags) || rawTags.length > MAX_TAGS) return null
  const tags = []
  for (const rawTag of rawTags) {
    if (typeof rawTag !== 'string') return null
    const tag = rawTag.trim()
    if (tag.length === 0 || tag.length > MAX_TAG_LENGTH) return null
    if (!tags.includes(tag)) tags.push(tag)
  }
  return tags
}

/** 校验并规范化单个候选；任何字段越界即丢弃（返回 null）。 */
function normalizeCandidate(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  if (!MEMORY_TYPES.includes(item.type)) return null

  if (typeof item.content !== 'string') return null
  const content = item.content.trim()
  if (content.length === 0 || content.length > MAX_CONTENT_LENGTH) return null

  const importance = item.importance === undefined ? 5 : item.importance
  if (!Number.isInteger(importance) || importance < 1 || importance > 10) return null

  const tags = normalizeCandidateTags(item.tags === undefined ? [] : item.tags)
  if (!tags) return null

  return { type: item.type, content, importance, tags }
}

/** 规范化精确去重：NFKC、忽略大小写与首尾/连续空白差异后做精确比较。 */
function normalizeForDedup(value) {
  return String(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

function containsSensitiveContent(value) {
  // 只认脱敏占位符本身：NFKC 归一化会把全角标点变半角，直接比较差分会把正常中文误判为敏感
  if (REDACTION_PLACEHOLDER_PATTERN.test(redactSensitiveText(value))) return true
  if (REDACTION_PLACEHOLDER_PATTERN.test(value)) return true
  return (
    SENSITIVE_LOCATION_PATTERNS.some((pattern) => pattern.test(value)) ||
    SENSITIVE_MEDICAL_PATTERNS.some((pattern) => pattern.test(value))
  )
}

async function findOwnedUserMessage(userId, messageId) {
  if (typeof messageId !== 'string' || messageId.trim().length === 0) {
    throw new HttpError('消息 ID 不能为空', 400)
  }
  const message = await prisma.message.findFirst({
    where: { id: messageId, conversation: { userId } },
  })
  if (!message) {
    const error = new Error('消息不存在')
    error.statusCode = 404
    throw error
  }
  if (message.role !== 'user') {
    throw new HttpError('只能对用户发送的消息生成记忆候选', 400)
  }
  return message
}

async function runCloudExtraction(text, requestId, userId) {
  const consent = await prisma.user.findUnique({
    where: { id: userId },
    select: { externalLlmConsent: true, externalLlmConsentVersion: true },
  })
  const allowExternal = consent?.externalLlmConsent === true
    && consent.externalLlmConsentVersion === EXTERNAL_LLM_CONSENT_VERSION
  // 云端切割后记忆候选同样走同意门：未同意不得调用云端模型
  assertCloudCallable(allowExternal)
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
  const gateway = await getGateway()
  const result = await gateway.complete({
    scene: 'explain',
    requestId,
    messages: [{ role: 'user', content: buildExtractionPrompt(text) }],
    allowExternal,
    authorizeExternal,
    timeoutMs: SUGGESTION_TIMEOUT_MS,
    maxTokens: MAX_SUGGESTION_TOKENS,
    temperature: SUGGESTION_TEMPERATURE,
  })
  if (!result?.content) throw new LlmUnavailableError()
  return result.content
}

/**
 * 为一条当前用户拥有的 user 消息生成记忆候选（最多 2 项，不落库）。
 * @returns {Promise<{candidates: Array<{type:string,content:string,importance:number,tags:string[]}>}>}
 */
export async function getMemorySuggestions(userId, messageId, requestId) {
  const message = await findOwnedUserMessage(userId, messageId)

  if (detectCrisis(message.content)) {
    logger.info('记忆建议结果', { requestId, count: 0, reason: 'crisis_excluded' })
    return { candidates: [] }
  }

  const safeText = redactSensitiveText(message.content).trim().slice(0, MAX_MODEL_MESSAGE_CHARS)
  const output = await runCloudExtraction(safeText, requestId, userId)

  const parsed = extractJsonArray(output)
  if (!parsed) {
    logger.info('记忆建议结果', { requestId, count: 0, reason: 'invalid_json' })
    return { candidates: [] }
  }

  const validated = parsed.map(normalizeCandidate).filter(Boolean)
  const isSensitive = (candidate) =>
    containsSensitiveContent(candidate.content) || candidate.tags.some(containsSensitiveContent)
  if (validated.some(isSensitive)) {
    logger.info('记忆建议结果', { requestId, count: 0, reason: 'sensitive_excluded' })
    return { candidates: [] }
  }

  const existing = await prisma.memory.findMany({
    where: { userId },
    select: { content: true },
    take: MAX_DEDUP_MEMORIES,
  })
  const seen = new Set(existing.map((memory) => normalizeForDedup(memory.content)))
  const candidates = []
  for (const candidate of validated) {
    const key = normalizeForDedup(candidate.content)
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push(candidate)
    if (candidates.length >= MAX_CANDIDATES) break
  }

  logger.info('记忆建议结果', { requestId, count: candidates.length })
  return { candidates }
}
