/**
 * 工作模式技能服务：SKILL.md 目录约定的技能扫描与按需加载。
 *
 * 目录下每个 <name>.md 即一个技能：name 须匹配 ^[a-z0-9][a-z0-9-]{0,49}$，
 * 可选 frontmatter（--- 包裹，仅解析 description 一行），无 frontmatter 时
 * 描述取正文首个非空行。模型经 use_skill 工具按需加载正文，清单只进提示词。
 * 缓存在启动扫描后生效：新增/编辑技能文件需重启 API。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}$/
const MAX_DESCRIPTION_LENGTH = 60

const isSkillsEnabled = () => process.env.SKILLS_ENABLED === 'true'

const skillsDir = () => process.env.SKILLS_DIR
  || fileURLToPath(new URL('../../data/skills', import.meta.url))

function clip(text, max = MAX_DESCRIPTION_LENGTH) {
  const value = String(text ?? '')
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** 解析单个技能文件：去 frontmatter 后正文为空返回 null。 */
function parseSkillFile(name, raw) {
  const lines = raw.split(/\r?\n/)
  let body = raw
  let description = null
  if (lines[0]?.trim() === '---') {
    const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
    if (endIndex !== -1) {
      for (let i = 1; i < endIndex; i += 1) {
        const match = lines[i].match(/^description\s*:\s*(.+)$/)
        if (match) description = match[1].trim()
      }
      body = lines.slice(endIndex + 1).join('\n')
    }
  }
  const content = body.trim()
  if (!content) return null
  if (!description) {
    const firstLine = content.split(/\r?\n/).find((line) => line.trim() !== '')
    description = clip(firstLine ?? '')
  }
  return { name, description, content }
}

let cache = null

/** 启动扫描：未启用或目录不存在时缓存为空表；单文件失败 warn 跳过。 */
export function scanSkills() {
  cache = new Map()
  if (!isSkillsEnabled()) return
  const dir = skillsDir()
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if (error.code !== 'ENOENT') logger.warn('技能目录读取失败', { error: error.message })
    return
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const name = entry.name.slice(0, -3)
    if (!NAME_PATTERN.test(name)) {
      logger.warn('技能文件名非法，跳过', { file: entry.name })
      continue
    }
    try {
      const skill = parseSkillFile(name, readFileSync(join(dir, entry.name), 'utf8'))
      if (!skill) {
        logger.warn('技能正文为空，跳过', { file: entry.name })
        continue
      }
      cache.set(name, skill)
    } catch (error) {
      logger.warn('技能文件解析失败，跳过', { file: entry.name, error: error.message })
    }
  }
}

/** 技能清单（name + description），未初始化（未扫描）时为空。 */
export function listSkillSummaries() {
  if (cache === null) return []
  return [...cache.values()].map(({ name, description }) => ({ name, description }))
}

/** 按需加载技能正文：未启用 503，未知名 404（原文透传给模型重试）。 */
export async function loadSkill(name) {
  if (!isSkillsEnabled()) throw new HttpError('技能未启用', 503)
  if (cache === null) scanSkills()
  const skill = cache.get(String(name ?? ''))
  if (!skill) throw new HttpError(`没有这个技能「${name}」`, 404)
  return { name: skill.name, content: skill.content }
}
