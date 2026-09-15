/**
 * 数据迁移导入服务：POST /api/user/import/preview 与 /apply 的执行体。
 *
 * 范围（自家导出包回灌）：
 * - 导入对象只有两类：人格 id、显式记忆候选（v2 含记忆关系）。
 * - 角色扮演已取消（2026-09 功能收拢）：导出包里的旧角色值与外部人设文本都不再导入。
 * - 预览绝不落库；应用只落用户逐条确认的候选，记忆经 createMemory 既有校验——导入不能绕过任何一道闸。
 * - 对话/日记/手帐等其余数据段不导入（无规范目标形态，v1 边界如实说明）。
 * - 同意状态绝不导入：重新同意是用户的主动行为（cloud-primary-v3）。
 * 日志只记 userId 与计数，不记导入内容。
 */
import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import { createMemory } from './memoryService.js'
import { PERSONAS, switchPersona } from './userService.js'
import { EXPORT_VERSION } from './exportService.js'
import { previewMemoryImport, applyMemoryImport } from './memoryTransferService.js'
import { conflict, withMemoryTransaction } from './memoryGovernance.js'
import logger from '../utils/logger.js'

const MAX_IMPORT_CANDIDATES = 100
const MAX_CONTENT_CHARS = 2000
const MAX_TAGS = 10
const MAX_TAG_CHARS = 30
const MEMORY_TYPES = ['semantic', 'episodic', 'procedural']

const isBundle = (payload) => payload && typeof payload === 'object'
  && [1, EXPORT_VERSION].includes(payload.version)
  && payload.product === 'Amie cyber-sister'

/** 与记忆建议一致口径的规范化去重键：NFKC + trim + 小写。 */
const normalizeKey = (text) => String(text ?? '').normalize('NFKC').trim().toLowerCase()

function validateMemoryShape(item) {
  if (!item || typeof item !== 'object') return null
  const type = MEMORY_TYPES.includes(item.type) ? item.type : null
  const content = typeof item.content === 'string' ? item.content.trim() : ''
  if (!type || !content || content.length > MAX_CONTENT_CHARS) return null
  const importance = item.importance === undefined ? 5 : item.importance
  if (!Number.isInteger(importance) || importance < 1 || importance > 10) return null
  const tags = Array.isArray(item.tags)
    ? item.tags.filter((t) => typeof t === 'string' && t.trim() && t.trim().length <= MAX_TAG_CHARS).map((t) => t.trim()).slice(0, MAX_TAGS)
    : []
  return { type, content, importance, tags }
}

async function existingMemoryKeys(userId, database = prisma) {
  const existing = await database.memory.findMany({ where: { userId }, select: { content: true } })
  return new Set(existing.map((m) => normalizeKey(m.content)))
}

function dedupeCandidates(items, existingKeys) {
  const candidates = []
  const seen = new Set(existingKeys)
  let skipped = 0
  for (const item of items) {
    if (candidates.length >= MAX_IMPORT_CANDIDATES) {
      skipped += items.length - (items.indexOf(item))
      break
    }
    const valid = validateMemoryShape(item)
    const key = valid ? normalizeKey(valid.content) : null
    if (!valid || seen.has(key)) {
      skipped += 1
      continue
    }
    seen.add(key)
    candidates.push(valid)
  }
  return { candidates, skipped }
}

function personaPreview(persona) {
  if (typeof persona !== 'string' || !persona) return null
  return PERSONAS.includes(persona)
    ? { id: persona, ok: true }
    : { id: persona, ok: false, error: `人格必须是以下值之一: ${PERSONAS.join(', ')}` }
}

/** 预览：解析导入负载为结构化候选，绝不落库。 */
export async function previewImport(userId, payload) {
  // 先读取版本：预览期间或之后的修改、清空、删除都会使确认失效。
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { memoryEpoch: true } })
  if (!user) throw new HttpError('用户不存在', 404)
  const memoryEpoch = user.memoryEpoch
  if (isBundle(payload) && payload.version === 2) {
    if (!payload.memoryBundle) throw new HttpError('v2 导出包缺少正式记忆及版本数据，不能降级导入', 400)
    const preview = await previewMemoryImport(userId, payload.memoryBundle)
    return { format: 'cyber-sister-export-v2', memoryEpoch, memoryCandidates: preview.memories, edges: preview.edges,
      persona: personaPreview(payload.user?.persona),
      memoriesSkipped: preview.memories.filter((item) => item.state === 'duplicate').length,
      notes: ['会恢复所选记忆的版本和所选关系；有冲突的记忆不会覆盖。', '聊天原文不导入，原始消息来源可能显示为缺失。云端授权不会导入。'],
    }
  }
  if (isBundle(payload)) {
    const existingKeys = await existingMemoryKeys(userId)
    const { candidates, skipped } = dedupeCandidates(payload.memories ?? [], existingKeys)
    return {
      format: 'cyber-sister-export',
      memoryEpoch,
      persona: personaPreview(payload.user?.persona),
      memoryCandidates: candidates,
      memoriesSkipped: skipped,
      notes: [
        '对话、日记、安排、经期、阅读，以及手帐、日程、倒数日、旧提醒、自习等历史数据段不导入（v1 边界）。',
        '云端模型同意状态不会导入：需要你主动重新同意。',
      ],
    }
  }

  throw new HttpError('无法识别的导入格式：只支持 Amie 导出包（JSON）', 400)
}

/** 应用：只落用户逐条确认的候选，全部走既有校验。 */
export async function applyImport(userId, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError('导入内容不能为空', 400)
  }
  const result = await withMemoryTransaction(userId, async (tx) => {
  if (payload.memoryBundle || (Array.isArray(payload.memories) && payload.memories.length)) {
    if (!Number.isInteger(payload.expectedMemoryEpoch) || payload.expectedMemoryEpoch < 0) throw new HttpError('请先预览要导入的记忆', 400)
    const current = await tx.user.findUnique({ where: { id: userId }, select: { memoryEpoch: true } })
    if (current?.memoryEpoch !== payload.expectedMemoryEpoch) throw conflict('记忆已变化，旧导入预览已失效，请重新预览；本次没有写入任何内容')
  }
  const result = { personaApplied: false, memoriesApplied: 0, memoriesSkipped: 0 }
  if (payload.memoryBundle) {
    Object.assign(result, await applyMemoryImport(userId, { bundle: payload.memoryBundle, selectedIds: payload.selectedIds, selectedEdgeIds: payload.selectedEdgeIds }, tx))
  }

  if (payload.persona) {
    await switchPersona(userId, payload.persona, tx)
    result.personaApplied = true
  }

  if (!payload.memoryBundle && Array.isArray(payload.memories) && payload.memories.length > 0) {
    const existingKeys = await existingMemoryKeys(userId, tx)
    const { candidates, skipped } = dedupeCandidates(payload.memories, existingKeys)
    result.memoriesSkipped += skipped
    for (const candidate of candidates) {
      // 形状无效的候选已在预处理跳过；数据库失败必须回滚整批，不能伪装成成功。
      // eslint-disable-next-line no-await-in-loop
      await createMemory(userId, candidate, { tx, projectEmbedding: false, action: 'import' })
      result.memoriesApplied += 1
    }
  }

  if (!payload.memoryBundle && !result.personaApplied && result.memoriesApplied === 0 && result.memoriesSkipped === 0) {
    throw new HttpError('没有可导入的内容', 400)
  }
  return result
  })
  logger.info('数据迁移导入', { userId, ...result })
  return result
}
