import { describe, expect, it } from 'vitest'
import { parseShareText, sourceOf } from './shareText'

// 样例是按各平台分享文字的格式编的，商品名与短链都是虚构的
describe('从分享文字里认出链接和名字', () => {
  it('淘宝：名字在「」里', () => {
    const text = '【淘宝】7天无理由退货 https://m.tb.cn/h.Abc123?tk=XyZ9 CZ0001 「法式复古碎花连衣裙女夏」点击链接直接打开 或者 淘宝搜索直接打开'
    expect(parseShareText(text)).toEqual({ link: 'https://m.tb.cn/h.Abc123?tk=XyZ9', name: '法式复古碎花连衣裙女夏', source: '淘宝' })
  })

  it('小红书：标题在链接前面，去掉「复制本条信息」这些套话', () => {
    const text = '秋天的第一支豆沙色口红 http://xhslink.com/a/Q1w2E3r4，复制本条信息，打开【小红书】App查看精彩内容！'
    expect(parseShareText(text)).toEqual({ link: 'http://xhslink.com/a/Q1w2E3r4', name: '秋天的第一支豆沙色口红', source: '小红书' })
  })

  it('小红书：只有口令码没有标题时，名字留空让你自己写', () => {
    const text = '示例作者发布了一篇小红书笔记，快来看吧！ 😆 Y8Kq2pLm 😆 http://xhslink.com/a/Q1w2E3r4，复制本条信息，打开【小红书】App查看精彩内容！'
    expect(parseShareText(text)).toEqual({ link: 'http://xhslink.com/a/Q1w2E3r4', name: '', source: '小红书' })
  })

  it('京东：「」里的商品名', () => {
    const text = '【京东】https://3.cn/2-AbCdEf「保湿粉底液 自然色 30ml」点击链接直接打开'
    expect(parseShareText(text)).toEqual({ link: 'https://3.cn/2-AbCdEf', name: '保湿粉底液 自然色 30ml', source: '京东' })
  })

  it('只有一个链接：名字留空，来源写域名或平台名', () => {
    expect(parseShareText('https://item.taobao.com/item.htm?id=1')).toEqual({ link: 'https://item.taobao.com/item.htm?id=1', name: '', source: '淘宝' })
    expect(parseShareText('  https://www.example.com/p/9。 ')).toEqual({ link: 'https://www.example.com/p/9', name: '', source: 'example.com' })
  })

  it('链接前后是一句自己写的话，就拿来当名字', () => {
    expect(parseShareText('想要这件米色风衣 https://shop.example.com/x').name).toBe('想要这件米色风衣')
  })

  it('没有链接、不是 http(s) 的都不算', () => {
    expect(parseShareText('只是随便写的几个字')).toEqual({ link: null, name: '', source: '' })
    expect(parseShareText('javascript:alert(1)')).toEqual({ link: null, name: '', source: '' })
    expect(parseShareText('')).toEqual({ link: null, name: '', source: '' })
    expect(sourceOf('不是链接')).toBe('')
  })

  it('名字最多 40 个字', () => {
    const long = `「${'长'.repeat(60)}」 https://m.tb.cn/h.x`
    expect(parseShareText(long).name).toHaveLength(40)
  })
})
