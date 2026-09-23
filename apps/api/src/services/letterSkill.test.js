import { describe, expect, it } from 'vitest'
import { LETTER_SKILL } from './letterSkill.js'

describe('letter skill', () => {
  it('命中来信话题时注入操作口径系统块', () => {
    const result = LETTER_SKILL.buildContext('她的来信写了什么，多久写一封')
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain('[Amie 内置技能：来信 v1]')
    expect(result[0].content).toContain('不要替用户采纳')
  })

  it.each(['推荐一部电影', '明天提醒我复诊', '谢谢'])('无关话题不注入：%s', (text) => {
    expect(LETTER_SKILL.buildContext(text)).toEqual([])
  })

  it('非 chat 场景不注入', () => {
    expect(LETTER_SKILL.buildContext('来信', [], 'explain')).toEqual([])
    expect(LETTER_SKILL.buildContext('来信', [], 'work')).toEqual([])
  })
})
