/**
 * 数据迁移导入服务：POST /api/user/import/preview 与 /apply 的执行体。
 *
 * v1 范围（迁移窗口：接住豆包/千问智能体难民 + 自家导出包回灌）：
 * - 导入对象只有三类：角色扮演（roleName/roleSetting）、人格 id、显式记忆候选。
 * - 预览绝不落库；应用只落用户逐条确认的候选，记忆经 createMemory 既有校验，
 *   角色扮演经 updateRolePlay 既有长度与恋人红线闸——导入不能绕过任何一道闸。
 * - 对话/日记/手帐等其余数据段不导入（无规范目标形态，v1 边界如实说明）。
 * - 同意状态绝不导入：重新同意是用户的主动行为（cloud-primary-v3）。
 * 日志只记 userId 与计数，不记导入内容。
 */
import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import { createMemory } from './memoryService.js'
import { PERSONAS, assertRolePlayAllowed, updateRolePlay, switchPersona } from './userService.js'
import { EXPORT_VERSION } from './exportService.js'
import logger from '../utils/logger.js'

const MAX_IMPORT_CANDIDATES = 100
const MAX_CONTENT_CHARS = 2000
const MAX_TAGS = 10
const MAX_TAG_CHARS = 30
const MEMORY_TYPES = ['semantic', 'episodic', 'procedural']

const isBundle = (payload) => payload && typeof payload === 'object'
  && payload.version === EXPORT_VERSION
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

async function existingMemoryKeys(userId) {
  const existing = await prisma.memory.findMany({ where: { userId }, select: { content: true } })
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

function rolePreview(roleName, roleSetting) {
  const name = typeof roleName === 'string' ? roleName.trim() : ''
  const setting = typeof roleSetting === 'string' ? roleSetting.trim() : ''
  if (!name && !setting) return null
  try {
    assertRolePlayAllowed(name, setting)
    return { name, setting, ok: true, error: null }
  } catch (error) {
    return { name, setting, ok: false, error: error.message }
  }
}

function personaPreview(persona) {
  if (typeof persona !== 'string' || !persona) return null
  return PERSONAS.includes(persona)
    ? { id: persona, ok: true }
    : { id: persona, ok: false, error: `人格必须是以下值之一: ${PERSONAS.join(', ')}` }
}

/** 预览：解析导入负载为结构化候选，绝不落库。 */
export async function previewImport(userId, payload) {
  if (isBundle(payload)) {
    const existingKeys = await existingMemoryKeys(userId)
    const { candidates, skipped } = dedupeCandidates(payload.memories ?? [], existingKeys)
    return {
      format: 'cyber-sister-export',
      role: rolePreview(payload.user?.roleName, payload.user?.roleSetting),
      persona: personaPreview(payload.user?.persona),
      memoryCandidates: candidates,
      memoriesSkipped: skipped,
      notes: [
        '对话、日记、手帐、日程、倒数日、经期、提醒、阅读、自习等数据段不导入（v1 边界）。',
        '云端模型同意状态不会导入：需要你主动重新同意。',
      ],
    }
  }

  if (payload?.format === 'persona-text') {
    const role = rolePreview(payload.roleName, payload.roleSetting)
    if (!role) throw new HttpError('人设文本不能为空', 400)
    return {
      format: 'persona-text',
      role,
      persona: null,
      memoryCandidates: [],
      memoriesSkipped: 0,
      notes: ['只导入角色扮演设定；记忆请在聊天里用「帮我记住」逐条确认。'],
    }
  }

  throw new HttpError('无法识别的导入格式：支持Amie导出包（JSON）或 persona-text 人设文本', 400)
}

/** 应用：只落用户逐条确认的候选，全部走既有校验与红线闸。 */
export async function applyImport(userId, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError('导入内容不能为空', 400)
  }
  const result = { roleApplied: false, personaApplied: false, memoriesApplied: 0, memoriesSkipped: 0 }

  if (payload.role) {
    // updateRolePlay 内含长度与恋人红线闸；校验失败按 400 透传，不静默降级
    await updateRolePlay(userId, { name: payload.role.name, setting: payload.role.setting })
    result.roleApplied = true
  }
  if (payload.persona) {
    await switchPersona(userId, payload.persona)
    result.personaApplied = true
  }

  if (Array.isArray(payload.memories) && payload.memories.length > 0) {
    const existingKeys = await existingMemoryKeys(userId)
    const { candidates, skipped } = dedupeCandidates(payload.memories, existingKeys)
    result.memoriesSkipped += skipped
    for (const candidate of candidates) {
      // createMemory 是校验唯一权威：非法候选按跳过计数，不拖垮整批
      try {
        // eslint-disable-next-line no-await-in-loop
        await createMemory(userId, candidate)
        result.memoriesApplied += 1
      } catch {
        result.memoriesSkipped += 1
      }
    }
  }

  if (!result.roleApplied && !result.personaApplied && result.memoriesApplied === 0) {
    throw new HttpError('没有可导入的内容', 400)
  }
  logger.info('数据迁移导入', { userId, ...result })
  return result
}
