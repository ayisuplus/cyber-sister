/**
 * 回复质量评测的数据集：评分标准（rubric.json）与场景集（scenarios.json）的读取和校验。
 * 数据放在 apps/api/tests/reply-eval/，冻结方式照「懂你」检验集：冻结后改期望要产品负责人确认。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { detectCrisis } from '../services/detection.js'

export const CATEGORIES = {
  emotion: '情绪倾诉',
  body: '身体与健康',
  relationship: '关系',
  boundary: '边界',
  careful: '中级危机（小心模式）',
  daily: '日常求助',
}
export const STYLE_IDS = ['gentle', 'toxic', 'cool']
export const LAYERS = { female: '女性层', safety: '安全', style: '说话方式' }

const DATE = /^\d{4}-\d{2}-\d{2}$/
const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const blank = (value) => typeof value !== 'string' || !value.trim()

export function loadDataset(dir) {
  const read = (name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8'))
  return { rubric: read('rubric.json'), scenarios: read('scenarios.json') }
}

/** 这个场景要跑哪几种说话方式：没写就三种都跑。 */
export const stylesOf = (scenario) => (scenario.personas?.length ? scenario.personas : STYLE_IDS)

function checkFreeze(doc, label, problems) {
  if (!Number.isInteger(doc.version) || doc.version < 1) problems.push(`${label}：version 必须是正整数`)
  if (doc.status === 'draft') {
    if (doc.frozenAt !== null) problems.push(`${label}：草案的 frozenAt 必须是 null`)
  } else if (doc.status === 'frozen') {
    if (!DATE.test(String(doc.frozenAt))) problems.push(`${label}：冻结后要写 frozenAt（YYYY-MM-DD）`)
  } else {
    problems.push(`${label}：status 只能是 draft 或 frozen`)
  }
}

/** 返回评分标准的全部问题（空数组＝没问题）。 */
export function validateRubric(rubric) {
  const problems = []
  checkFreeze(rubric, '评分标准', problems)
  const ids = new Set()
  for (const item of rubric.items ?? []) {
    if (!/^R\d+$/.test(item.id ?? '')) problems.push(`评分条目 id 不合规：${item.id}`)
    if (ids.has(item.id)) problems.push(`评分条目重复：${item.id}`)
    ids.add(item.id)
    for (const field of ['name', 'question', 'source']) {
      if (blank(item[field])) problems.push(`${item.id} 缺少 ${field}`)
    }
    if (!Object.hasOwn(LAYERS, item.layer)) problems.push(`${item.id} 的 layer 只能是 female / safety / style`)
    if (item.layer === 'style' && !String(item.question).includes('{style}')) problems.push(`${item.id} 要用 {style} 带上她选的说话方式`)
  }
  if (!ids.size) problems.push('评分标准一条都没有')
  for (const id of STYLE_IDS) {
    if (blank(rubric.styles?.[id])) problems.push(`缺少说话方式的描述：${id}`)
  }
  return problems
}

function checkShape(scenario, label, problems) {
  if (!/^[a-z]\d{2}-[a-z0-9-]+$/.test(scenario.id ?? '')) problems.push(`场景 id 不合规：${label}`)
  if (!Object.hasOwn(CATEGORIES, scenario.category)) problems.push(`${label}：未知类别 ${scenario.category}`)
  if (blank(scenario.title) || blank(scenario.text)) problems.push(`${label}：缺少 title 或 text`)
  for (const style of scenario.personas ?? []) {
    if (!STYLE_IDS.includes(style)) problems.push(`${label}：未知说话方式 ${style}`)
  }
  const history = scenario.history ?? []
  if (history.length > 6) problems.push(`${label}：history 最多 3 轮（6 条）`)
  if (history.some((turn) => !['user', 'assistant'].includes(turn?.role) || blank(turn?.content))) {
    problems.push(`${label}：history 里有不合规的一条`)
  }
  if (scenario.given?.localTime !== undefined && !LOCAL_TIME.test(scenario.given.localTime)) {
    problems.push(`${label}：localTime 要写成 HH:MM`)
  }
}

function checkRubricRefs(scenario, label, rubricIds, problems) {
  const applicable = scenario.rubric ?? []
  if (!applicable.length) problems.push(`${label}：没有适用的评分条目`)
  for (const id of applicable) {
    if (!rubricIds.has(id)) problems.push(`${label}：引用了不存在的评分条目 ${id}`)
  }
  const pair = scenario.pair ?? {}
  if (blank(pair.better) || blank(pair.common) || pair.better === pair.common) problems.push(`${label}：pair 要有两条不同的回复`)
  const fails = pair.commonFails ?? []
  if (!fails.length) problems.push(`${label}：commonFails 至少写一条`)
  for (const id of fails) {
    if (!applicable.includes(id)) problems.push(`${label}：commonFails 里的 ${id} 不在这个场景适用的条目里`)
  }
}

// 小心模式的场景必须被判成中级；其余场景不能误触危机分流，否则比的就不是同一件事
function checkCrisisLevel(scenario, label, problems) {
  const level = detectCrisis(scenario.text ?? '')
  const expected = scenario.category === 'careful' ? 'medium' : null
  if (level !== expected) problems.push(`${label}：危机检测判成了 ${level ?? '无'}，与类别不符`)
}

/** 返回场景集的全部问题（空数组＝没问题）。危机分级用真实检测核对，免得场景跑偏了类别。 */
export function validateScenarios(scenarios, rubric) {
  const problems = []
  checkFreeze(scenarios, '场景集', problems)
  const rubricIds = new Set((rubric.items ?? []).map((item) => item.id))
  const ids = new Set()
  for (const scenario of scenarios.cases ?? []) {
    const label = scenario.id ?? '（没有 id）'
    if (ids.has(scenario.id)) problems.push(`场景重复：${label}`)
    ids.add(scenario.id)
    checkShape(scenario, label, problems)
    checkRubricRefs(scenario, label, rubricIds, problems)
    checkCrisisLevel(scenario, label, problems)
  }
  if (!ids.size) problems.push('场景集一个场景都没有')
  return problems
}
