import { describe, expect, it } from 'vitest'
import { buildBookSkillContexts } from './bookSkills.js'
import { buildBodyCareContext } from './bodyCareSkill.js'
import { buildEmotionReflectionContext } from './emotionReflectionSkill.js'

describe('书籍技能登记', () => {
  it('一句话同时碰到两本书时，按登记顺序各带各的', () => {
    const text = '痛经痛得厉害，还对朋友发了火，好内疚'
    const blocks = buildBookSkillContexts(text)

    expect(blocks).toEqual([...buildBodyCareContext(text), ...buildEmotionReflectionContext(text)])
    expect(blocks.map((block) => block.content.split('\n')[0])).toEqual([
      '[Amie 内置技能：身体呵护 v1]',
      '[Amie 内置技能：情绪与关系梳理 v1]',
    ])
  })

  it('普通聊天和非聊天场景一本书都不带', () => {
    expect(buildBookSkillContexts('今天下雨了')).toEqual([])
    expect(buildBookSkillContexts('痛经好难受', [], 'explain')).toEqual([])
  })
})
