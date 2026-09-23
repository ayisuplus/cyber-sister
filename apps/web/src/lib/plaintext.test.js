import { describe, expect, it } from 'vitest'
import { decodePlainText, readPlainText } from './plaintext'

const utf8 = (text) => new TextEncoder().encode(text).buffer

describe('读 TXT', () => {
  it('按章节标题切，标题就是章节名', () => {
    const book = readPlainText(utf8([
      '第一章 出门',
      '我比现在年轻十岁的时候。',
      '',
      '第二章 回家',
      '那天傍晚下起了雨。',
    ].join('\n')))

    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['第一章 出门', '第二章 回家'])
    expect(book.chapters[0].text).toContain('我比现在年轻十岁的时候。')
    expect(book.chapters[1].text).toContain('那天傍晚下起了雨。')
  })

  it('第一个标题之前的序言不会丢', () => {
    const book = readPlainText(utf8('这是一段序。\n\n第一章 出门\n正文一\n\n第二章 回家\n正文二'))

    expect(book.chapters[0]).toMatchObject({ title: '开头' })
    expect(book.chapters[0].text).toBe('这是一段序。')
    expect(book.chapters).toHaveLength(3)
  })

  it('切不出章节就按长度分段，不假装有目录', () => {
    const book = readPlainText(utf8('一段没有任何章节标题的长文。'.repeat(1000)))

    expect(book.chapters.length).toBeGreaterThan(1)
    expect(book.chapters[0].title).toBe('第 1 段')
    expect(book.chapters.every((chapter) => chapter.text.length <= 4000)).toBe(true)
  })

  it('只有一处像标题时当作误判', () => {
    const book = readPlainText(utf8('第一章 出门\n' + '正文。'.repeat(50)))

    expect(book.chapters[0].title).toBe('第 1 段')
  })

  it('GBK 的中文 TXT 也能读', () => {
    // “你好世界”的 GBK 字节
    const gbk = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3, 0xca, 0xc0, 0xbd, 0xe7])

    expect(decodePlainText(gbk.buffer)).toBe('你好世界')
  })

  it('认得出 UTF-8 与 UTF-16 的 BOM', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('带 BOM')])
    expect(decodePlainText(withBom.buffer)).toBe('带 BOM')

    const utf16 = new Uint8Array([0xff, 0xfe, 0x60, 0x4f, 0x7d, 0x59])
    expect(decodePlainText(utf16.buffer)).toBe('你好')
  })

  it('空文件直接说清楚', () => {
    expect(() => readPlainText(utf8('   \n  '))).toThrow('空的')
  })
})
