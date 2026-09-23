import { describe, expect, it } from 'vitest'
import { COLLECTION_SKILL } from './collectionSkill.js'

describe('collection skill', () => {
  it('命中收藏话题时注入操作口径系统块', () => {
    const result = COLLECTION_SKILL.buildContext('这件穿搭怎么搭，衣柜里有什么')
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain('[Amie 内置技能：收藏 v1]')
    expect(result[0].content).toContain('柜子不能换')
  })

  it.each(['推荐一部电影', '明天提醒我复诊', '谢谢'])('无关话题不注入：%s', (text) => {
    expect(COLLECTION_SKILL.buildContext(text)).toEqual([])
  })

  it('非 chat 场景不注入', () => {
    expect(COLLECTION_SKILL.buildContext('想买这件收藏', [], 'explain')).toEqual([])
    expect(COLLECTION_SKILL.buildContext('想买这件收藏', [], 'work')).toEqual([])
  })
})
