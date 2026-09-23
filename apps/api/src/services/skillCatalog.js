/**
 * 技能目录：SKILL.md 发现、frontmatter 解析与技能内文件读取的唯一入口。
 *
 * 发现来源（重名 first-wins，先到先得）：
 *   ① <repo>/.pi/skills/        pi 项目级约定，团队放一个 SKILL.md 即多一个技能
 *   ② 扩展经 resources_discover / registerSkillPath 贡献的路径
 *   ③ apps/api/src/skills/      随应用分发的内置技能
 * 目录不存在或为空 → 0 个技能，不报错。扫描规则：含 SKILL.md 的目录即技能根（不再下钻），
 * 根下的单个 .md 也是独立技能；跳过点开头的目录与 node_modules。
 *
 * frontmatter 只认 key: value 行（宽松校验，照 pi）：description 是唯一硬门槛，
 * 缺失或为空的技能跳过并 warn；name 违规只 warn 仍加载，缺省回退目录名/文件名。
 * 正文不缓存，按需读盘。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HttpError } from '../utils/dbHelpers.js'
import { nativeObject, nativeString } from '../utils/toolSchema.js'
import logger from '../utils/logger.js'

const PROJECT_SKILLS_DIR = fileURLToPath(new URL('../../../../.pi/skills/', import.meta.url))
const BUILTIN_SKILLS_DIR = fileURLToPath(new URL('../skills/', import.meta.url))

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_NAME_LENGTH = 64
const MAX_DESCRIPTION_LENGTH = 1024

const FRONTMATTER_PATTERN = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

/** 约 30 行的 frontmatter 子集：只认 key: value 行，其余视为解析失败；正文按原文切出，不改动换行符。 */
function parseFrontmatter(text) {
  if (!/^---[ \t]*\r?\n/.test(text)) return { ok: true, fields: {}, body: text }
  const match = FRONTMATTER_PATTERN.exec(text)
  if (!match) return { ok: false, fields: {}, body: text }
  const fields = {}
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const field = /^([\w.-]+):\s*(.*)$/.exec(trimmed)
    if (!field) return { ok: false, fields: {}, body: text }
    let value = field[2].trim()
    if ((value.startsWith('"') && value.endsWith('"') && value.length >= 2) || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
      value = value.slice(1, -1)
    }
    fields[field[1]] = value
  }
  return { ok: true, fields, body: text.slice(match[0].length) }
}

/** 一个技能文件（SKILL.md 或单文件 .md）解析成元数据；不合格返回 null（调用方 warn）。 */
function parseSkillFile(filePath, baseDir, fallbackName, sourceRank) {
  let parsed
  try {
    parsed = parseFrontmatter(readFileSync(filePath, 'utf8'))
  } catch (error) {
    logger.warn('技能文件读取失败，已跳过', { filePath, error: error?.message || String(error) })
    return null
  }
  const { ok, fields } = parsed
  if (!ok) {
    logger.warn('技能 frontmatter 解析失败，已跳过', { filePath })
    return null
  }
  if (!fields.description) {
    logger.warn('技能缺少 description，已跳过', { filePath })
    return null
  }
  let name = fallbackName
  if (fields.name) {
    name = fields.name
    if (name.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(name)) {
      logger.warn('技能 name 不符合 [a-z0-9-] 约定，仍按原样加载', { filePath, name })
    }
  }
  let description = fields.description
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    logger.warn('技能 description 超长，已截断', { filePath })
    description = description.slice(0, MAX_DESCRIPTION_LENGTH)
  }
  return {
    name,
    description,
    filePath,
    baseDir,
    sourceRank,
    disableModelInvocation: String(fields['disable-model-invocation'] ?? '').trim().toLowerCase() === 'true',
  }
}

/** 一个目录项解析成技能元数据（子目录看 SKILL.md，单文件 .md 即整技能）；不是技能返回 null。 */
function parseEntry(dir, entry, sourceRank) {
  if (entry.name.startsWith('.') || entry.name === 'node_modules') return null
  if (entry.isDirectory()) {
    const skillFile = path.join(dir, entry.name, 'SKILL.md')
    if (!existsSync(skillFile)) return null
    return parseSkillFile(skillFile, path.join(dir, entry.name), entry.name, sourceRank)
  }
  if (entry.isFile() && entry.name.endsWith('.md')) {
    return parseSkillFile(path.join(dir, entry.name), dir, entry.name.replace(/\.md$/, ''), sourceRank)
  }
  return null
}

/** 扫一个来源目录：自身是技能根就只收自己，否则收一层的技能目录与单文件 .md。 */
function scanRoot(dir, sourceRank) {
  if (!dir || !existsSync(dir)) return []
  const ownSkill = path.join(dir, 'SKILL.md')
  if (existsSync(ownSkill)) {
    const meta = parseSkillFile(ownSkill, dir, path.basename(dir), sourceRank)
    return meta ? [meta] : []
  }
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    // 目录在 existsSync 之后被移除/占用：逐路径容错，不当成启动故障
    logger.warn('技能目录读取失败，已跳过', { dir, error: error?.message || String(error) })
    return []
  }
  const found = []
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const meta = parseEntry(dir, entry, sourceRank)
    if (meta) found.push(meta)
  }
  return found
}

let catalog = null
const extraSkillPaths = new Set()

function buildCatalog() {
  const roots = [
    { dir: PROJECT_SKILLS_DIR, rank: 1 },
    ...[...extraSkillPaths].map((dir) => ({ dir, rank: 2 })),
    { dir: BUILTIN_SKILLS_DIR, rank: 3 },
  ]
  const byName = new Map()
  for (const { dir, rank } of roots) {
    for (const skill of scanRoot(dir, rank)) {
      const winner = byName.get(skill.name)
      if (winner) {
        logger.warn('技能重名，先发现的生效', { name: skill.name, winner: winner.filePath, loser: skill.filePath })
        continue
      }
      byName.set(skill.name, skill)
    }
  }
  return byName
}

/**
 * 懒加载 + 缓存：首次访问时构建；传入 extraPaths（扩展贡献的技能路径）会并入第 ② 优先级并重建。
 * 测试与排障用 resetSkillCatalog() 丢掉快照。
 */
export function loadSkillCatalog({ extraPaths } = {}) {
  let changed = false
  for (const dir of extraPaths || []) {
    if (!extraSkillPaths.has(dir)) {
      extraSkillPaths.add(dir)
      changed = true
    }
  }
  if (!catalog || changed) catalog = buildCatalog()
  return catalog
}

/** 丢掉快照，回到「还没扫过」（测试与排障用）。 */
export function resetSkillCatalog() {
  catalog = null
  extraSkillPaths.clear()
}

export function getSkill(name) {
  return loadSkillCatalog().get(String(name ?? ''))
}

function skillNames() {
  return [...loadSkillCatalog().keys()]
}

/**
 * 读技能内文件原文；relPath 省略 = SKILL.md（剥掉 frontmatter）。
 * relPath 解析后必须仍在技能目录内，否则 400「路径越界」。
 */
export function readSkillResource(name, relPath) {
  const skill = getSkill(name)
  if (!skill) throw new HttpError('没有这个技能', 404)
  const target = relPath === undefined || relPath === null ? skill.filePath : path.resolve(skill.baseDir, String(relPath))
  if (target !== skill.filePath && !target.startsWith(skill.baseDir + path.sep)) throw new HttpError('路径越界', 400)
  let content
  try {
    content = readFileSync(target, 'utf8')
  } catch {
    throw new HttpError('技能里没有这个文件', 404)
  }
  return target === skill.filePath ? parseFrontmatter(content).body : content
}

/** SKILL.md 里 `## heading` 到下一个 `## ` 之间的正文（trim）；与旧 .split('## …')[1].split('## …')[0].trim() 等价。 */
export function skillSection(name, heading) {
  const body = readSkillResource(name)
  const marker = `## ${heading}`
  const start = body.indexOf(marker)
  if (start === -1) {
    logger.warn('技能缺少小节', { name, heading })
    return ''
  }
  const tail = body.slice(start + marker.length)
  const end = tail.indexOf('## ')
  return (end === -1 ? tail : tail.slice(0, end)).trim()
}

/** 模型可见的技能目录（disable-model-invocation 的不出现在这里）；0 个技能返回空串。 */
export function availableSkillsXml() {
  const visible = [...loadSkillCatalog().values()].filter((skill) => !skill.disableModelInvocation)
  if (visible.length === 0) return ''
  const entries = visible.map((skill) => [
    '  <skill>',
    `    <name>${skill.name}</name>`,
    `    <description>${skill.description}</description>`,
    '  </skill>',
  ].join('\n'))
  return [
    '【可用技能】以下技能有专门的操作说明。当任务与某个技能的用途匹配时，先用 load_skill 工具读取它的完整说明再照做。',
    '<available_skills>',
    ...entries,
    '</available_skills>',
  ].join('\n')
}

export const SKILL_SYSTEM_TOOLS = {
  load_skill: {
    description: '{"tool":"load_skill","args":{"name":"技能名","path":"可选 技能内文件相对路径如 references/api.md"}} 读取一个技能的完整说明，或技能内的参考文件。当任务与某个技能的用途匹配、或需要技能里的参考资料时，先调用它拿到完整说明再照做；不要凭想象复述技能内容',
    run: (_userId, args = {}) => {
      const name = String(args.name ?? '')
      const skill = getSkill(name)
      if (!skill) throw new HttpError('没有这个技能，可用的技能有：' + skillNames().join('、'), 404)
      const relPath = String(args.path ?? '').trim()
      const body = readSkillResource(name, relPath || undefined)
      // 不给模型服务器路径：技能内相对文件靠 path 参数读取（托管多租户不泄露文件系统布局）
      const content = `<skill name="${name}">\n文中的相对路径文件用 load_skill 的 path 参数读取\n\n${body}\n</skill>`
      return { summary: '已读取技能 ' + name, result: { name, content } }
    },
  },
}

export const SKILL_SYSTEM_PARAMETERS = {
  load_skill: nativeObject({ name: nativeString, path: nativeString }, ['name']),
}
