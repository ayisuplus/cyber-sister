import { describe, expect, it } from 'vitest'
import { PERIOD_SKILL } from './periodSkill.js'

describe('period skill', () => {
  it('命中经期话题时注入操作口径系统块', () => {
    const result = PERIOD_SKILL.buildContext('大姨妈来了，痛经')
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain('[Amie 内置技能：经期 v1]')
    expect(result[0].content).toContain('敏感个人信息')
  })

  it.each(['推荐一部电影', '提醒我喝水', '谢谢'])('无关话题不注入：%s', (text) => {
    expect(PERIOD_SKILL.buildContext(text)).toEqual([])
  })

  it('非 chat 场景不注入', () => {
    expect(PERIOD_SKILL.buildContext('经期什么时候来', [], 'explain')).toEqual([])
    expect(PERIOD_SKILL.buildContext('经期什么时候来', [], 'work')).toEqual([])
  })
})
