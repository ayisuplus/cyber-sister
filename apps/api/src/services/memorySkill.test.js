import { describe, expect, it } from 'vitest'
import { MEMORY_SKILL } from './memorySkill.js'

describe('memory skill', () => {
  it('命中记忆话题时注入操作口径系统块', () => {
    const result = MEMORY_SKILL.buildContext('她记得我什么，帮我改记忆')
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain('[Amie 内置技能：记忆 v1]')
    expect(result[0].content).toContain('只能由用户创建和维护')
  })

  it.each(['推荐一部电影', '明天提醒我复诊', '谢谢'])('无关话题不注入：%s', (text) => {
    expect(MEMORY_SKILL.buildContext(text)).toEqual([])
  })

  it('非 chat 场景不注入', () => {
    expect(MEMORY_SKILL.buildContext('删记忆', [], 'explain')).toEqual([])
    expect(MEMORY_SKILL.buildContext('删记忆', [], 'work')).toEqual([])
  })
})
