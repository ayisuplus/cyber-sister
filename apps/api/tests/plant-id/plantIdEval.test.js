import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { candidateMatches, renderPlantComparison, renderPlantReport, scoreCase, summarizePlantRun, validatePlantCases } from '../../src/eval/plantIdEval.js'
import { FUNGI_CAUTION } from '../../src/services/plantIdentification.js'

// 只测打分与用例集本身：不联网、不读照片（照片在仓库外）
const suite = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'))
const identified = (candidates, extra = {}) => ({ isPlant: true, candidates, explanation: null, caution: null, ...extra })

describe('花草识别检验集', () => {
  it('用例集本身没有问题', () => {
    expect(validatePlantCases(suite)).toEqual([])
    expect(suite.cases.length).toBeGreaterThanOrEqual(30)
  })

  it('查得出坏用例：重复、照片带目录、植物没写名字、毒性写错', () => {
    const bad = { status: 'draft', cases: [
      { id: 'x', file: 'a/x.jpg', group: 'campus', expect: { names: [], toxic: 'yes' } },
      { id: 'x', file: 'y.jpg', group: 'garden', expect: { names: ['花'], scientific: 'Rosa', toxic: null } },
    ] }
    const problems = validatePlantCases(bad)
    expect(problems).toEqual(expect.arrayContaining([
      'x：file 要写照片的文件名（不带目录）', 'x：植物要写至少一个接受的中文名', 'x：toxic 只能是 true / false / null',
      'x：id 重复', 'x：group 只能是 campus / home / not-plant / fungus', 'x：学名「Rosa」至少要有属名和种加词',
    ]))
  })
})

describe('打分', () => {
  const gardenia = { id: 'c01', group: 'campus', expect: { names: ['栀子花', '栀子'], scientific: 'Gardenia jasminoides', toxic: null } }
  const lily = { id: 'h11', group: 'home', expect: { names: ['百合'], scientific: 'Lilium', genusOk: true, toxic: true } }

  it('中文名或学名的属 + 种对上都算认对；属对上只在 genusOk 时算', () => {
    expect(candidateMatches({ name: '栀子' }, gardenia.expect)).toBe(true)
    expect(candidateMatches({ name: '水栀子', scientificName: 'Gardenia jasminoides var. radicans' }, gardenia.expect)).toBe(true)
    expect(candidateMatches({ name: '狗牙花', scientificName: 'Gardenia augusta' }, gardenia.expect)).toBe(false)
    expect(candidateMatches({ name: '香水百合', scientificName: 'Lilium Oriental Group' }, lily.expect)).toBe(true)
    expect(candidateMatches({ name: '樱花', scientificName: 'Prunus × yedoensis' }, { names: [], scientific: 'Prunus yedoensis' })).toBe(true)
  })

  it('第一个认错、第二个对：前三算对；标了「很像」算过于自信', () => {
    const row = scoreCase(gardenia, identified([
      { name: '白兰', scientificName: 'Michelia alba', likelihood: '很像' },
      { name: '栀子花', scientificName: 'Gardenia jasminoides', likelihood: '可能是' },
    ]))
    expect(row).toMatchObject({ top1: false, top3: true, overconfident: true, humble: false, failed: false })
  })

  it('有毒的看有没有提醒；没毒的提醒了算误报；毒性不计的两样都不算', () => {
    expect(scoreCase(lily, identified([{ name: '百合', likelihood: '很像' }], { caution: '对猫毒性很强。' }))).toMatchObject({ toxic: true, cautioned: true })
    const safe = { ...gardenia, expect: { ...gardenia.expect, toxic: false } }
    expect(scoreCase(safe, identified([{ name: '栀子花', likelihood: '很像' }], { caution: '别吃。' }))).toMatchObject({ falseAlarm: true })
    expect(scoreCase(gardenia, identified([{ name: '栀子花', likelihood: '很像' }], { caution: '别吃。' }))).toMatchObject({ toxic: null, falseAlarm: null })
  })

  it('不是植物看拒认；菌菇看固定提醒；调用失败记一笔，认对与否都算没认对', () => {
    expect(scoreCase({ id: 'n01', group: 'not-plant', expect: { isPlant: false } }, { isPlant: false, candidates: [] })).toMatchObject({ rejected: true, top1: null })
    expect(scoreCase({ id: 'f01', group: 'fungus', expect: { fungus: true } }, identified([{ name: '鸡枞' }], { caution: FUNGI_CAUTION }))).toMatchObject({ fungusWarned: true })
    expect(scoreCase(gardenia, null)).toMatchObject({ failed: true, top1: false, top3: false, humble: null })
  })

  it('名录组：名录里的标准名与接受学名也算认对，毒性库有记载也算提醒了；另记第一个候选核不核得到', () => {
    const oleander = { id: 'c13', group: 'campus', expect: { names: ['夹竹桃'], scientific: 'Nerium oleander', toxic: true } }
    const result = identified([{ name: '欧洲夹竹桃', scientificName: 'Nerium indicum', likelihood: '很像' }], {
      reference: {
        checked: true, toxicChecked: true,
        candidates: [{ found: true, standardName: '夹竹桃', scientificName: 'Nerium oleander' }],
        toxic: [{ candidate: 0, name: '夹竹桃', level: null, parts: [] }],
      },
    })
    expect(scoreCase(oleander, result)).toMatchObject({ top1: false, cautioned: false, refFound: true })
    expect(scoreCase(oleander, result, 'reference')).toMatchObject({ top1: true, cautioned: true, refFound: true })
    // 没装名录：refFound 为 null，不进「名录核实」
    expect(scoreCase(oleander, identified([{ name: '夹竹桃', likelihood: '很像' }]))).toMatchObject({ refFound: null })
  })

  it('两组对照：同一份回答算两遍；「名录核实」分认对和认错两边', () => {
    const oleander = { id: 'c13', group: 'campus', expect: { names: ['夹竹桃'], scientific: 'Nerium oleander', toxic: true } }
    const lily = { id: 'h11', group: 'home', expect: { names: ['百合'], scientific: 'Lilium', genusOk: true, toxic: true } }
    const results = [
      [oleander, identified([{ name: '欧洲夹竹桃', scientificName: 'Nerium indicum', likelihood: '很像' }], {
        reference: { checked: true, candidates: [{ found: true, standardName: '夹竹桃', scientificName: 'Nerium oleander' }], toxic: [{ candidate: 0, name: '夹竹桃' }] },
      })],
      [lily, identified([{ name: '萱草', likelihood: '可能是' }], { reference: { checked: true, candidates: [{ found: false }], toxic: [] } })],
    ]
    const cloudRows = results.map(([testCase, result]) => scoreCase(testCase, result))
    const referenceRows = results.map(([testCase, result]) => scoreCase(testCase, result, 'reference'))
    expect(summarizePlantRun(referenceRows)).toMatchObject({ top1: { hit: 1, of: 2 }, toxicRecall: { hit: 1, of: 2 }, foundWhenRight: { hit: 1, of: 1 }, foundWhenWrong: { hit: 0, of: 1 } })

    const text = renderPlantComparison({ referenceNote: '（名录已装，毒性库已装）' }, cloudRows, referenceRows)
    expect(text).toContain('| 第一个候选认对 | 0/2（0%） | 1/2（50%） |')
    expect(text).toContain('| 有毒的提醒了 | 0/2（0%） | 1/2（50%） |')
    expect(text).toContain('认错时核得到 0/1（0%）')
  })

  it('汇总与报告：错的排在前面', () => {
    const rows = [
      scoreCase(gardenia, identified([{ name: '栀子花', likelihood: '很像' }])),
      scoreCase(lily, identified([{ name: '郁金香', likelihood: '拿不准' }], { caution: '对猫有毒。' })),
      scoreCase({ id: 'n01', group: 'not-plant', expect: { isPlant: false } }, { isPlant: false, candidates: [] }),
    ]
    const summary = summarizePlantRun(rows)
    expect(summary).toMatchObject({ cases: 3, failed: 0, top1: { hit: 1, of: 2 }, humbleWhenWrong: { hit: 1, of: 1 }, toxicRecall: { hit: 1, of: 1 }, rejected: { hit: 1, of: 1 } })
    const report = renderPlantReport({ run: 't', arm: 'cloud', model: 'm', promptVersion: 'plant-id-v1', suiteVersion: 'v1', suiteStatus: 'draft', said: { h11: '郁金香' } }, rows, summary)
    expect(report).toContain('| 第一个候选认对 | 1/2（50%） |')
    expect(report.indexOf('| h11 |')).toBeLessThan(report.indexOf('| c01 |'))
  })
})
