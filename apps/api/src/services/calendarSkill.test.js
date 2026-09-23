import { describe, expect, it } from 'vitest'
import { CALENDAR_SKILL } from './calendarSkill.js'

describe('calendar skill', () => {
  it('命中日历话题时注入操作口径系统块', () => {
    const result = CALENDAR_SKILL.buildContext('明天提醒我复诊，改期到下午')
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain('[Amie 内置技能：日历 v1]')
    expect(result[0].content).toContain('add_task')
    expect(result[0].content).toContain('day_review')
  })

  it.each(['推荐一部电影', '比较两个数组', '谢谢'])('无关话题不注入：%s', (text) => {
    expect(CALENDAR_SKILL.buildContext(text)).toEqual([])
  })

  it('非 chat 场景不注入', () => {
    expect(CALENDAR_SKILL.buildContext('日历上有什么安排', [], 'explain')).toEqual([])
    expect(CALENDAR_SKILL.buildContext('日历上有什么安排', [], 'work')).toEqual([])
  })
})
