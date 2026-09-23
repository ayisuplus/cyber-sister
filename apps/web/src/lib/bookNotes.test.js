import { describe, expect, it } from 'vitest'
import { chapterNotes, markChapter, noteChapter, unanchoredNotes } from './bookNotes'

const TEXT = '我比现在年轻十岁的时候，获得了一个游手好闲的职业，去乡间收集民间歌谣。'
const note = (id, quote, locator) => ({ id, quote, locator, content: `笔记 ${id}` })

describe('笔记落回正文', () => {
  it('按引文找到位置，把正文切成带标记的段', () => {
    const segments = markChapter(TEXT, [note('n1', '游手好闲', '0:17')])

    expect(segments.map((segment) => segment.text)).toEqual([
      '我比现在年轻十岁的时候，获得了一个',
      '游手好闲',
      '的职业，去乡间收集民间歌谣。',
    ])
    expect(segments[1].note.id).toBe('n1')
    expect(segments[0].note).toBeUndefined()
    expect(segments.map((segment) => segment.text).join('')).toBe(TEXT)
  })

  it('偏移对不上也能靠引文找回来', () => {
    const segments = markChapter(TEXT, [note('n1', '民间歌谣', '0:0')])

    expect(segments.find((segment) => segment.note)?.text).toBe('民间歌谣')
  })

  it('引文在这一章里找不到就不标，也不报错', () => {
    const segments = markChapter(TEXT, [note('n1', '这句书里没有', '0:3')])

    expect(segments).toEqual([{ text: TEXT }])
  })

  it('没有引文的笔记不参与标注', () => {
    expect(markChapter(TEXT, [note('n1', '', '0:3')])).toEqual([{ text: TEXT }])
    expect(markChapter(TEXT, [note('n1', null, '0:3')])).toEqual([{ text: TEXT }])
  })

  it('两条划到同一句时只留先出现的那条，不套两层', () => {
    const segments = markChapter(TEXT, [
      note('n1', '游手好闲的职业', '0:17'),
      note('n2', '好闲的职', '0:19'),
    ])

    const marked = segments.filter((segment) => segment.note)
    expect(marked).toHaveLength(1)
    expect(marked[0].note.id).toBe('n1')
    expect(segments.map((segment) => segment.text).join('')).toBe(TEXT)
  })

  it('多条各自标出来，顺序按正文先后', () => {
    const segments = markChapter(TEXT, [
      note('n2', '民间歌谣', '0:30'),
      note('n1', '年轻十岁', '0:3'),
    ])

    expect(segments.filter((segment) => segment.note).map((segment) => segment.note.id)).toEqual(['n1', 'n2'])
  })

  it('整段就是引文时不留空段', () => {
    expect(markChapter('就这一句', [note('n1', '就这一句', '0:0')])).toEqual([
      { text: '就这一句', note: expect.objectContaining({ id: 'n1' }) },
    ])
  })
})

describe('笔记归到哪一章', () => {
  it('从 locator 取章序号，取不出来就是没有位置', () => {
    expect(noteChapter('3:1024')).toBe(3)
    expect(noteChapter('0:0')).toBe(0)
    expect(noteChapter(null)).toBeNull()
    expect(noteChapter('')).toBeNull()
    expect(noteChapter('第三章:10')).toBeNull()
  })

  it('第 1 章不会把第 13 章的笔记算进来', () => {
    const notes = [note('a', '甲', '1:0'), note('b', '乙', '13:0')]

    expect(chapterNotes(notes, 1).map((item) => item.id)).toEqual(['a'])
    expect(chapterNotes(notes, 13).map((item) => item.id)).toEqual(['b'])
  })

  it('没位置的、引文对不上的，都归到「正文里标不出来」那一类', () => {
    const chapters = [{ text: TEXT }]
    const notes = [
      note('anchored', '游手好闲', '0:17'),
      note('noLocator', '随口记的', null),
      note('missing', '书里没有这句', '0:0'),
    ]

    expect(unanchoredNotes(notes, chapters).map((item) => item.id)).toEqual(['noLocator', 'missing'])
  })
})
