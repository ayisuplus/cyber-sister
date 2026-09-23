import { describe, expect, it } from 'vitest'
import { READING_SKILL } from './readingSkill.js'

describe('reading skill', () => {
  it('命中读书话题时注入操作口径系统块', () => {
    const result = READING_SKILL.buildContext('这本书读到哪了，帮我记一笔')
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain('[Amie 内置技能：读书 v1]')
    expect(result[0].content).toContain('只能删了重记')
  })

  it.each(['推荐一部电影', '明天提醒我复诊', '谢谢'])('无关话题不注入：%s', (text) => {
    expect(READING_SKILL.buildContext(text)).toEqual([])
  })

  it('非 chat 场景不注入', () => {
    expect(READING_SKILL.buildContext('书架上有什么', [], 'explain')).toEqual([])
    expect(READING_SKILL.buildContext('书架上有什么', [], 'work')).toEqual([])
  })
})
