import { describe, expect, it } from 'vitest'
import { NOTES_SKILL } from './notesSkill.js'

describe('notes skill', () => {
  it('命中手记话题时注入操作口径系统块', () => {
    const result = NOTES_SKILL.buildContext('帮我看看今天的日记写了没')
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('system')
    expect(result[0].content).toContain('[Amie 内置技能：手记 v1]')
    expect(result[0].content).toContain('一天一篇')
  })

  it.each(['推荐一部电影', '比较两个数组', '谢谢'])('无关话题不注入：%s', (text) => {
    expect(NOTES_SKILL.buildContext(text)).toEqual([])
  })

  it('非 chat 场景不注入', () => {
    expect(NOTES_SKILL.buildContext('写一篇日记', [], 'explain')).toEqual([])
    expect(NOTES_SKILL.buildContext('写一篇日记', [], 'work')).toEqual([])
    expect(NOTES_SKILL.buildContext(undefined)).toEqual([])
  })
})
