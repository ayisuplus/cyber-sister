import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../prisma/client.js', () => ({ default: {} }))
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { listSkillSummaries, loadSkill, scanSkills } from './skillService.js'

describe('skillService', () => {
  let dir
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'skills-'))
    process.env.SKILLS_DIR = dir
  })
  afterEach(() => {
    delete process.env.SKILLS_ENABLED
    delete process.env.SKILLS_DIR
    rmSync(dir, { recursive: true, force: true })
  })

  it('loadSkill 惰性触发扫描（缓存未初始化时；须为本文件首个用例）', async () => {
    process.env.SKILLS_ENABLED = 'true'
    writeFileSync(join(dir, 'lazy.md'), '惰性正文')
    const skill = await loadSkill('lazy')
    expect(skill.content).toBe('惰性正文')
  })
  it('未启用时清单为空，loadSkill 抛 503', async () => {
    writeFileSync(join(dir, 'a-skill.md'), '正文')
    scanSkills()
    expect(listSkillSummaries()).toEqual([])
    await expect(loadSkill('a-skill')).rejects.toMatchObject({ statusCode: 503, message: '技能未启用' })
  })

  it('目录不存在时清单为空', () => {
    process.env.SKILLS_ENABLED = 'true'
    process.env.SKILLS_DIR = join(dir, 'missing')
    scanSkills()
    expect(listSkillSummaries()).toEqual([])
  })

  it('frontmatter 提供描述，正文去除 frontmatter', async () => {
    process.env.SKILLS_ENABLED = 'true'
    writeFileSync(join(dir, 'pdf-report.md'), '---\ndescription: 生成 PDF 报告\n---\n第一步做A\n第二步做B\n')
    scanSkills()
    expect(listSkillSummaries()).toEqual([{ name: 'pdf-report', description: '生成 PDF 报告' }])
    const skill = await loadSkill('pdf-report')
    expect(skill).toEqual({ name: 'pdf-report', content: '第一步做A\n第二步做B' })
  })

  it('无 frontmatter 时描述回退为正文首个非空行', () => {
    process.env.SKILLS_ENABLED = 'true'
    writeFileSync(join(dir, 'plain.md'), '\n\n第一行描述\n其余正文\n')
    scanSkills()
    expect(listSkillSummaries()).toEqual([{ name: 'plain', description: '第一行描述' }])
  })

  it('非法文件名与空正文跳过，非 md 文件忽略', () => {
    process.env.SKILLS_ENABLED = 'true'
    writeFileSync(join(dir, 'Bad_Name.md'), '正文')
    writeFileSync(join(dir, 'empty.md'), '---\ndescription: x\n---\n   \n')
    writeFileSync(join(dir, 'notes.txt'), '不是技能')
    writeFileSync(join(dir, 'ok.md'), '可用正文')
    scanSkills()
    expect(listSkillSummaries().map((s) => s.name)).toEqual(['ok'])
  })

  it('未知名抛 404 原文', async () => {
    process.env.SKILLS_ENABLED = 'true'
    scanSkills()
    await expect(loadSkill('ghost')).rejects.toMatchObject({ statusCode: 404, message: '没有这个技能「ghost」' })
  })

})
