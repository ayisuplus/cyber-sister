/**
 * 花草识别离线评测（路线图 C26，见 docs/04-开发/花草识别评测.md）：纯打分，不联网。
 *
 * 一条用例是一张照片和它该是什么：认得对不对（第一个 / 前三个）、认错时有没有老实说「拿不准」、
 * 有毒的有没有提醒、不是植物的有没有拒认、菌菇有没有给那句固定提醒。
 * 结果按「组」（arm）存：云端视觉模型一组；同一份回答在本机名录与毒性库里核过，另算一组（路线图 C27），
 * 不多花一次调用。以后加本机识花小模型，同一套用例、同一套打分直接对照。
 */
import { FUNGI_CAUTION } from '../services/plantIdentification.js'

export const PLANT_EVAL_ARMS = {
  cloud: { id: 'cloud', label: '只用模型（聊天那个视觉模型，提示词 plant-id-v1）' },
  reference: { id: 'reference', label: '模型 + 本机名录与毒性库' },
}

const normalize = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase()
// 学名只比前两个词（属 + 种），杂交符号与大小写不算；变种、品种名不比
const binomial = (value) => String(value ?? '').normalize('NFKC').replace(/[×✕]/g, ' ').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 2)
const asList = (value) => (Array.isArray(value) ? value : value ? [value] : [])

/** 一个候选算不算认对：中文名在接受的名字里，或者学名的属 + 种对上（genusOk 时属对上就算）。 */
export function candidateMatches(candidate, expect) {
  if (!candidate || !expect) return false
  if (asList(expect.names).map(normalize).includes(normalize(candidate.name))) return true
  const [genus, species] = binomial(candidate.scientificName)
  if (!genus) return false
  return asList(expect.scientific).some((expected) => {
    const [wantGenus, wantSpecies] = binomial(expected)
    if (genus !== wantGenus) return false
    return expect.genusOk === true || (Boolean(species) && species === wantSpecies)
  })
}

/** 名录组：候选在名录里核到了，名录里的标准名与接受学名也算这个候选的名字 */
const withReferenceNames = (candidates, reference) => candidates.map((candidate, index) => {
  const found = reference?.candidates?.[index]
  return found?.found ? [candidate, { name: found.standardName, scientificName: found.scientificName }] : [candidate]
})

/**
 * 给一条用例打分。result 是读出来的识别结果（readIdentification 的形状），读不出来或调用失败为 null。
 * arm 为 reference 时：名录里的标准名与接受学名也算认对；毒性库有记载也算提醒了。
 * @returns {{ id: string, group: string, failed: boolean, top1: boolean|null, top3: boolean|null, humble: boolean|null,
 *   overconfident: boolean|null, toxic: boolean|null, cautioned: boolean, falseAlarm: boolean|null, rejected: boolean|null, fungusWarned: boolean|null }}
 */
/** 每条都有的几项：该不该提醒、提醒了没有、第一个候选在名录里核不核得到（没装名录为 null） */
function baseRow(testCase, result, reference) {
  const toxic = testCase.expect.toxic
  const firstFound = result?.reference?.candidates?.[0]?.found
  return {
    id: testCase.id, group: testCase.group, failed: !result,
    top1: null, top3: null, humble: null, overconfident: null,
    toxic: typeof toxic === 'boolean' ? toxic : null,
    cautioned: Boolean(result?.caution || reference?.toxic?.length), falseAlarm: null,
    rejected: null, fungusWarned: null,
    refFound: result?.reference?.checked ? Boolean(firstFound) : null,
  }
}

export function scoreCase(testCase, result, arm = 'cloud') {
  const { expect } = testCase
  const reference = arm === 'reference' ? result?.reference : null
  const row = baseRow(testCase, result, reference)
  if (expect.fungus) return { ...row, fungusWarned: result?.caution === FUNGI_CAUTION }
  if (expect.isPlant === false) return { ...row, rejected: result ? result.isPlant === false : false }
  return { ...row, ...plantScores(expect, result, reference), falseAlarm: row.toxic === false ? row.cautioned : null }
}

/** 植物那几条：第一个 / 前三个认对；认错时第一个候选标的是「很像」就是过于自信，标「可能是 / 拿不准」算老实 */
function plantScores(expect, result, reference) {
  const candidates = result?.isPlant ? result.candidates : []
  const names = withReferenceNames(candidates, reference)
  const matches = (position) => (names[position] ?? []).some((name) => candidateMatches(name, expect))
  const top1 = matches(0)
  const overconfident = result && !top1 ? candidates[0]?.likelihood === '很像' : null
  return { top1, top3: [0, 1, 2].some(matches), overconfident, humble: overconfident === null ? null : !overconfident }
}

const rate = (rows, key) => {
  const scored = rows.filter((row) => typeof row[key] === 'boolean')
  return { hit: scored.filter((row) => row[key]).length, of: scored.length }
}

/** 汇总：认对（第一个 / 前三个）、认错时老实、有毒提醒的召回与误报、非植物拒认、菌菇提醒、失败次数。 */
export function summarizePlantRun(rows) {
  const plants = rows.filter((row) => row.top1 !== null)
  const toxic = rows.filter((row) => row.toxic === true)
  const checked = plants.filter((row) => row.refFound !== null)
  return {
    cases: rows.length,
    failed: rows.filter((row) => row.failed).length,
    foundWhenRight: { hit: checked.filter((row) => row.top1 && row.refFound).length, of: checked.filter((row) => row.top1).length },
    foundWhenWrong: { hit: checked.filter((row) => !row.top1 && row.refFound).length, of: checked.filter((row) => !row.top1).length },
    top1: rate(plants, 'top1'),
    top3: rate(plants, 'top3'),
    humbleWhenWrong: rate(rows, 'humble'),
    toxicRecall: { hit: toxic.filter((row) => row.cautioned).length, of: toxic.length },
    falseAlarm: rate(rows, 'falseAlarm'),
    rejected: rate(rows, 'rejected'),
    fungusWarned: rate(rows, 'fungusWarned'),
  }
}

const GROUPS = new Set(['campus', 'home', 'not-plant', 'fungus'])

/** 植物那几条的期望：接受的名字、学名形状、毒性三选一。 */
function expectProblems(where, expect) {
  const problems = []
  if (!asList(expect.names).length) problems.push(`${where}：植物要写至少一个接受的中文名`)
  for (const scientific of asList(expect.scientific)) {
    if (binomial(scientific).length < (expect.genusOk ? 1 : 2)) problems.push(`${where}：学名「${scientific}」至少要有属名和种加词`)
  }
  if (![true, false, null].includes(expect.toxic)) problems.push(`${where}：toxic 只能是 true / false / null`)
  return problems
}

/** 一条用例：id、照片文件名、分组，植物再看期望。seen 记着前面用过的 id 与文件名。 */
function caseProblems(raw, seen) {
  const { id, file, group, expect = {} } = raw ?? {}
  const where = id ?? '(没有 id)'
  const problems = []
  if (!id) problems.push('有一条没有 id')
  else if (seen.ids.has(id)) problems.push(`${where}：id 重复`)
  seen.ids.add(id)
  if (!file || /[\\/]/.test(file)) problems.push(`${where}：file 要写照片的文件名（不带目录）`)
  else if (seen.files.has(file)) problems.push(`${where}：file 重复`)
  seen.files.add(file)
  if (!GROUPS.has(group)) problems.push(`${where}：group 只能是 ${[...GROUPS].join(' / ')}`)
  return expect.fungus || expect.isPlant === false ? problems : [...problems, ...expectProblems(where, expect)]
}

/** 检验用例集本身：id 不重、照片文件名写了、植物有接受的名字、学名形状对、毒性只能是 true / false / null。 */
export function validatePlantCases(suite) {
  if (!suite || !Array.isArray(suite.cases)) return ['缺 cases 数组']
  const problems = []
  if (!['draft', 'frozen'].includes(suite.status)) problems.push('status 只能是 draft 或 frozen')
  if (suite.status === 'frozen' && !suite.frozenAt) problems.push('冻结了要写 frozenAt')
  const seen = { ids: new Set(), files: new Set() }
  return [...problems, ...suite.cases.flatMap((testCase) => caseProblems(testCase, seen))]
}

const pct = ({ hit, of }) => (of ? `${hit}/${of}（${Math.round((hit / of) * 100)}%）` : '—')
const mark = (value) => (value === null ? '' : value ? '✓' : '✗')

/** 两组对照：同一份回答，只用模型 vs 模型 + 本机名录与毒性库。 */
export function renderPlantComparison(meta, cloudRows, referenceRows) {
  const cloud = summarizePlantRun(cloudRows)
  const grounded = summarizePlantRun(referenceRows)
  const line = (label, key) => `| ${label} | ${pct(cloud[key])} | ${pct(grounded[key])} |`
  return [
    '## 两组对照',
    '',
    `| 指标 | ${PLANT_EVAL_ARMS.cloud.label} | ${PLANT_EVAL_ARMS.reference.label} |`,
    '|---|---|---|',
    line('第一个候选认对', 'top1'),
    line('前三个候选里有对的', 'top3'),
    line('有毒的提醒了', 'toxicRecall'),
    line('没毒却提醒（误报）', 'falseAlarm'),
    '',
    `名录核实：第一个候选认对时名录里核得到 ${pct(grounded.foundWhenRight)}，认错时核得到 ${pct(grounded.foundWhenWrong)}（两个数差得越多，「名录里没查到」越能提醒她可能认错了）。${meta.referenceNote ?? ''}`,
    '',
  ].join('\n')
}

/** markdown 报告：先总数，再逐条（错的在前）。 */
export function renderPlantReport(meta, rows, summary = summarizePlantRun(rows)) {
  const lines = [
    `# 花草识别评测 ${meta.run}`,
    '',
    `- 组：${PLANT_EVAL_ARMS[meta.arm]?.label ?? meta.arm}；模型：${meta.model ?? '—'}；提示词：${meta.promptVersion ?? '—'}`,
    `- 用例集：${meta.suiteVersion}（${meta.suiteStatus}）；这一轮 ${summary.cases} 条，调用失败或读不出 ${summary.failed} 条`,
    '',
    '| 指标 | 结果 |',
    '|---|---|',
    `| 第一个候选认对 | ${pct(summary.top1)} |`,
    `| 前三个候选里有对的 | ${pct(summary.top3)} |`,
    `| 认错时老实（没标「很像」） | ${pct(summary.humbleWhenWrong)} |`,
    `| 有毒的提醒了 | ${pct(summary.toxicRecall)} |`,
    `| 没毒却提醒（误报） | ${pct(summary.falseAlarm)} |`,
    `| 不是植物的拒认 | ${pct(summary.rejected)} |`,
    `| 菌菇给了固定提醒 | ${pct(summary.fungusWarned)} |`,
    '',
    '| 用例 | 组 | 第一个 | 前三 | 认错时老实 | 该提醒 | 提醒了 | 拒认 | 菌菇 | 她说 |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ]
  const wrongFirst = [...rows].sort((a, b) => Number(a.top1 !== false) - Number(b.top1 !== false))
  for (const row of wrongFirst) {
    const said = meta.said?.[row.id] ?? (row.failed ? '（失败）' : '')
    lines.push(`| ${row.id} | ${row.group} | ${mark(row.top1)} | ${mark(row.top3)} | ${mark(row.humble)} | ${mark(row.toxic)} | ${row.cautioned ? '✓' : ''} | ${mark(row.rejected)} | ${mark(row.fungusWarned)} | ${said} |`)
  }
  return `${lines.join('\n')}\n`
}
