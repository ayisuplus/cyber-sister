import { describe, expect, it } from 'vitest'
import { buildBookSkillContexts, describeBookNotes, selectBookCards } from './bookSkills.js'
import { buildBodyCareContext } from './bodyCareSkill.js'
import { buildEmotionReflectionContext } from './emotionReflectionSkill.js'

const contexts = (text, history = [], scene = 'chat') => buildBookSkillContexts(selectBookCards({ text, history, scene }), text)

describe('书籍技能登记', () => {
  it('一句话同时碰到两本书时，按登记顺序各带各的', () => {
    const text = '痛经痛得厉害，还对朋友发了火，好内疚'
    const blocks = contexts(text)

    expect(blocks).toEqual([...buildBodyCareContext(text), ...buildEmotionReflectionContext(text)])
    expect(blocks.map((block) => block.content.split('\n')[0])).toEqual([
      '[Amie 内置技能：身体呵护 v1]',
      '[Amie 内置技能：情绪与关系梳理 v1]',
    ])
  })

  it('普通聊天和非聊天场景一本书都不带', () => {
    expect(contexts('今天下雨了')).toEqual([])
    expect(contexts('痛经好难受', [], 'explain')).toEqual([])
  })

  it('几本书一起排，全局最多翻两章，各书轮流出自己最靠前的一章', () => {
    const text = '痛经又白带多，还嫉妒她，好内疚'
    const selection = selectBookCards({ text })
    expect(selection.map(({ book, cards }) => [book.name, cards.map(({ id }) => id)])).toEqual([
      ['body-care', ['ch01-discharge']],
      ['emotion-reflection', ['envy']],
    ])
    expect(contexts(text).map((block) => block.content.match(/^# .*/gm))).toEqual([['# 分泌物与清洁'], ['# 比较与嫉羡']])
  })

  it('页边批注写的是书目、章与边界，和提示词里翻的是同一次选择', () => {
    const selection = selectBookCards({ text: '同门拿了青基，我嘴上恭喜心里发酸，嫉妒得睡不着' })
    expect(describeBookNotes(selection)).toEqual([{
      book: 'emotion-reflection',
      title: '嫉羡与感恩',
      author: '梅兰妮·克莱因',
      edition: '九州出版社，2017',
      setAside: expect.stringContaining('死本能'),
      boundary: 'Amie 选择性改编，理论参考，不是诊断或治疗。',
      chapters: [{ id: 'envy', title: '比较与嫉羡', origin: '第十章', use: '情绪与具体愿望、行为分开' }],
    }])
    expect(describeBookNotes([])).toEqual([])
  })

  it('点名要理论、没翻到具体章时，批注只写书', () => {
    const [note] = describeBookNotes(selectBookCards({ text: '克莱因的理论是怎么说的' }))
    expect(note).toMatchObject({ book: 'emotion-reflection', chapters: [] })
  })

  it('她说了不要分析，这本书不翻，也就没有批注', () => {
    expect(describeBookNotes(selectBookCards({ text: '我嫉妒，但不要分析我' }))).toEqual([])
  })
})
