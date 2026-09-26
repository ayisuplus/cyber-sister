import { describe, expect, it } from 'vitest'
import { mapChecklist } from './plantChecklist.js'

// 自己编的几行，不是真名录
describe('名录表格 → 名录索引', () => {
  it('接受名与异名各占一行：用「名称状态」「接受名」连起来；表头前面的说明行跳过', () => {
    const { taxa, synonyms, headers } = mapChecklist([
      ['中国生物物种名录 2026 植物界'],
      ['中文名', '学名', '名称状态', '接受名', '科中文名', '别名', '审核专家'],
      ['夹竹桃', 'Nerium oleander L.', '接受名', '', '夹竹桃科', '欧洲夹竹桃；柳叶桃', '某专家'],
      ['', 'Nerium indicum Mill.', '异名', 'Nerium oleander L.', '夹竹桃科', '', ''],
      ['秋英', 'Cosmos bipinnatus Cav.', '接受名', '', '菊科', '波斯菊', ''],
      ['重复的', 'Cosmos bipinnatus', '接受名', '', '菊科', '', ''],
      ['属', 'Cosmos', '接受名', '', '菊科', '', ''],
    ])
    expect(headers).toContain('学名')
    expect(taxa).toEqual([
      { cn: '夹竹桃', sci: 'Nerium oleander L.', family: '夹竹桃科', aliases: ['欧洲夹竹桃', '柳叶桃'], scrutiny: '某专家' },
      { cn: '秋英', sci: 'Cosmos bipinnatus Cav.', family: '菊科', aliases: ['波斯菊'], scrutiny: null },
    ])
    expect(synonyms).toEqual({ 'nerium indicum': 0 })
  })

  it('一行一种、异名列在一格里；学名分成属、种加词几列也认', () => {
    const { taxa, synonyms } = mapChecklist([
      ['Chinese name', 'Genus', 'Species', 'Infraspecific rank', 'Infraspecific epithet', 'Synonyms', 'Family'],
      ['海芋', 'Alocasia', 'odora', '', '', 'Alocasia macrorrhiza (L.) Schott; Colocasia odora Brongn.', 'Araceae'],
      ['水仙', 'Narcissus', 'tazetta', 'var.', 'chinensis', '', 'Amaryllidaceae'],
    ])
    expect(taxa.map((taxon) => taxon.sci)).toEqual(['Alocasia odora', 'Narcissus tazetta var. chinensis'])
    expect(synonyms).toEqual({ 'alocasia macrorrhiza': 0, 'colocasia odora': 0 })
  })

  it('认不出学名或中文名那一列：把看到的表头报出来', () => {
    expect(() => mapChecklist([['序号', '名称', '备注'], ['1', 'x', 'y']])).toThrow(/认不出学名或中文名那一列。前几行是：序号、名称、备注/)
  })
})
