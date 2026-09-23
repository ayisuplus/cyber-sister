import { mkdirSync, mkdtempSync, rmSync, rmdirSync, writeFileSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('../utils/logger.js', () => ({ default: logger }))

import {
  availableSkillsXml,
  getSkill,
  loadSkillCatalog,
  readSkillResource,
  resetSkillCatalog,
  SKILL_SYSTEM_TOOLS,
  skillSection,
} from './skillCatalog.js'

const PROJECT_SKILLS_DIR = fileURLToPath(new URL('../../../../.pi/skills/', import.meta.url))
const BUILTIN_SKILLS_DIR = fileURLToPath(new URL('../skills/', import.meta.url))
const PROJECT_FOO = path.join(PROJECT_SKILLS_DIR, 'foo.md')

// 现有 9 个内置技能（name = 目录名）
const BUILTIN_SKILLS = ['body-care', 'calendar', 'collection', 'emotion-reflection', 'letter', 'memory', 'notes', 'period', 'reading']

describe('skillCatalog 发现与 frontmatter', () => {
  let tempRoot
  beforeEach(() => {
    resetSkillCatalog()
    logger.warn.mockClear()
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'amie-skills-'))
  })
  afterEach(() => {
    resetSkillCatalog()
    rmSync(tempRoot, { recursive: true, force: true })
    rmSync(PROJECT_FOO, { force: true })
    // 只清理由本测试建出来的空目录；.pi/ 里还有别的内容时 rmdir 自然失败，不动它
    for (const dir of [PROJECT_SKILLS_DIR, path.dirname(PROJECT_SKILLS_DIR)]) {
      try { rmdirSync(dir) } catch { /* 非空或不存在：保留 */ }
    }
  })

  it('缺 description 的 SKILL.md 被跳过并 warn', () => {
    mkdirSync(path.join(tempRoot, 'bad'), { recursive: true })
    writeFileSync(path.join(tempRoot, 'bad', 'SKILL.md'), '---\nname: bad\n---\n正文\n')
    loadSkillCatalog({ extraPaths: [tempRoot] })
    expect(getSkill('bad')).toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith('技能缺少 description，已跳过', expect.objectContaining({ filePath: expect.stringContaining('bad') }))
  })

  it('frontmatter 解析失败的技能跳过并 warn', () => {
    mkdirSync(path.join(tempRoot, 'broken'), { recursive: true })
    writeFileSync(path.join(tempRoot, 'broken', 'SKILL.md'), '---\n这不是键值行\ndescription: x\n---\n正文\n')
    loadSkillCatalog({ extraPaths: [tempRoot] })
    expect(getSkill('broken')).toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith('技能 frontmatter 解析失败，已跳过', expect.any(Object))
  })

  it('name 缺省回退目录名，正文按需读取', () => {
    mkdirSync(path.join(tempRoot, 'solo'), { recursive: true })
    writeFileSync(path.join(tempRoot, 'solo', 'SKILL.md'), '---\ndescription: 只有描述\n---\n# 正文\n\n内容\n')
    loadSkillCatalog({ extraPaths: [tempRoot] })
    const skill = getSkill('solo')
    expect(skill).toMatchObject({ name: 'solo', description: '只有描述', sourceRank: 2 })
    expect(readSkillResource('solo')).toBe('# 正文\n\n内容\n')
  })

  it('非法 name 仍加载原样，只 warn', () => {
    mkdirSync(path.join(tempRoot, 'weird'), { recursive: true })
    writeFileSync(path.join(tempRoot, 'weird', 'SKILL.md'), '---\nname: Foo_Bar-\ndescription: 描述\n---\n正文\n')
    loadSkillCatalog({ extraPaths: [tempRoot] })
    expect(getSkill('Foo_Bar-')).toMatchObject({ name: 'Foo_Bar-', description: '描述' })
    expect(logger.warn).toHaveBeenCalledWith('技能 name 不符合 [a-z0-9-] 约定，仍按原样加载', expect.objectContaining({ name: 'Foo_Bar-' }))
  })

  it('.pi/skills/ 根下的单个 .md 是独立技能', () => {
    mkdirSync(PROJECT_SKILLS_DIR, { recursive: true })
    writeFileSync(PROJECT_FOO, '---\nname: foo\ndescription: 单文件技能\n---\nfoo 正文\n')
    loadSkillCatalog()
    expect(getSkill('foo')).toMatchObject({ name: 'foo', description: '单文件技能', sourceRank: 1 })
    expect(readSkillResource('foo')).toBe('foo 正文\n')
  })

  it('重名 first-wins：项目级覆盖内置，同级先扫到的赢，warn 带双方路径', () => {
    mkdirSync(path.join(tempRoot, 'memory'), { recursive: true })
    writeFileSync(path.join(tempRoot, 'memory', 'SKILL.md'), '---\ndescription: 来自扩展\n---\n覆盖后的正文\n')
    loadSkillCatalog({ extraPaths: [tempRoot] })
    expect(getSkill('memory')).toMatchObject({ description: '来自扩展', sourceRank: 2 })
    expect(skillSection('memory', '核心行为')).toBe('')
    expect(readSkillResource('memory')).toBe('覆盖后的正文\n')
    expect(logger.warn).toHaveBeenCalledWith('技能重名，先发现的生效', expect.objectContaining({
      name: 'memory',
      winner: expect.stringContaining('amie-skills-'),
      loser: expect.stringContaining('skills'),
    }))

    resetSkillCatalog()
    logger.warn.mockClear()
    const first = path.join(tempRoot, 'first')
    const second = path.join(tempRoot, 'second')
    for (const [dir, description] of [[first, '甲'], [second, '乙']]) {
      mkdirSync(path.join(dir, 'dup'), { recursive: true })
      writeFileSync(path.join(dir, 'dup', 'SKILL.md'), `---\ndescription: ${description}\n---\n正文\n`)
    }
    loadSkillCatalog({ extraPaths: [first, second] })
    expect(getSkill('dup')).toMatchObject({ description: '甲' })
    expect(logger.warn).toHaveBeenCalledWith('技能重名，先发现的生效', expect.objectContaining({ name: 'dup' }))
  })
})

describe('readSkillResource 路径边界', () => {
  beforeEach(() => resetSkillCatalog())

  it.each([
    ['../../bootstrap.js'],
    ['/etc/passwd'],
    ['../notes/SKILL.md'],
  ])('越界路径抛 400：%s', (relPath) => {
    try {
      readSkillResource('memory', relPath)
      expect.unreachable('应当抛出路径越界')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 400, message: '路径越界' })
    }
  })

  it('技能内子文件返回原文，SKILL.md 剥掉 frontmatter', () => {
    expect(readSkillResource('body-care', 'chapters/ch01-discharge.md')).toContain('白带')
    expect(readSkillResource('memory')).not.toContain('---')
    expect(readSkillResource('memory')).toContain('# 记忆')
  })

  it('技能或文件不存在分别 404', () => {
    try {
      readSkillResource('nope')
      expect.unreachable('应当抛出没有这个技能')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 404, message: '没有这个技能' })
    }
    try {
      readSkillResource('memory', 'missing.md')
      expect.unreachable('应当抛出没有这个文件')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 404, message: '技能里没有这个文件' })
    }
  })
})

describe('skillSection 等价切换', () => {
  beforeEach(() => resetSkillCatalog())

  it.each(BUILTIN_SKILLS)('%s 的核心行为段与旧 split 链完全一致', (name) => {
    const raw = readFileSync(path.join(BUILTIN_SKILLS_DIR, name, 'SKILL.md'), 'utf8')
    const legacy = raw.split('## 核心行为')[1].split('## 方法取舍')[0].trim()
    expect(skillSection(name, '核心行为')).toBe(legacy)
  })
})

describe('SKILL_SYSTEM_TOOLS.load_skill', () => {
  beforeEach(() => {
    resetSkillCatalog()
    logger.warn.mockClear()
  })

  it('没有这个技能时 404 并列出可用技能名', async () => {
    try {
      await SKILL_SYSTEM_TOOLS.load_skill.run('u1', { name: 'nope' })
      expect.unreachable('应当抛出没有这个技能')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 404 })
      expect(error.message.startsWith('没有这个技能，可用的技能有：')).toBe(true)
      expect(error.message).toContain('body-care')
      expect(error.message).toContain('memory')
    }
  })

  it('返回包好的正文，不带 frontmatter 和服务器路径', async () => {
    const { summary, result } = await SKILL_SYSTEM_TOOLS.load_skill.run('u1', { name: 'memory' })
    expect(summary).toBe('已读取技能 memory')
    expect(result.name).toBe('memory')
    expect(result.content.startsWith('<skill name="memory">\n文中的相对路径文件用 load_skill 的 path 参数读取\n\n')).toBe(true)
    expect(result.content.endsWith('</skill>')).toBe(true)
    expect(result.content).toContain('她记得的你')
    expect(result.content).not.toContain('description:')
    expect(result.content).not.toContain('skills/memory')
  })

  it('path 参数读技能内参考文件', async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'amie-skills-'))
    try {
      mkdirSync(path.join(tempRoot, 'refskill'), { recursive: true })
      writeFileSync(path.join(tempRoot, 'refskill', 'SKILL.md'), '---\ndescription: 带参考文件\n---\n正文\n')
      writeFileSync(path.join(tempRoot, 'refskill', 'notes.md'), '参考文件内容\n')
      loadSkillCatalog({ extraPaths: [tempRoot] })
      const { result } = await SKILL_SYSTEM_TOOLS.load_skill.run('u1', { name: 'refskill', path: 'notes.md' })
      expect(result.content).toContain('参考文件内容')
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})

describe('availableSkillsXml', () => {
  beforeEach(() => resetSkillCatalog())

  it('按目录披露名称与用途，隐藏技能不出现', () => {
    const xml = availableSkillsXml()
    expect(xml).toContain('【可用技能】以下技能有专门的操作说明。当任务与某个技能的用途匹配时，先用 load_skill 工具读取它的完整说明再照做。')
    expect(xml).toContain('<available_skills>')
    expect(xml).toContain('<name>memory</name>')
    expect(xml).toContain('<description>「她记得的你」的对话操作口径')
    expect(xml).toContain('<name>body-care</name>')
  })

  it('disable-model-invocation 的技能不出现在目录里', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'amie-skills-'))
    mkdirSync(path.join(tempRoot, 'hidden'), { recursive: true })
    writeFileSync(path.join(tempRoot, 'hidden', 'SKILL.md'), '---\ndescription: 不给模型看\ndisable-model-invocation: true\n---\n正文\n')
    loadSkillCatalog({ extraPaths: [tempRoot] })
    expect(getSkill('hidden')).toBeTruthy()
    expect(availableSkillsXml()).not.toContain('<name>hidden</name>')
    rmSync(tempRoot, { recursive: true, force: true })
  })
})
