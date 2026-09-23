/**
 * 汇总与报告：把一次评测的原始记录（生成、逐条判断、两两比较、打分模型自检）算成通过率与胜率，
 * 再写成一份给人看的 markdown。全部是纯函数，原始记录另存 JSONL 以便复核。
 */
import { ARMS } from './arms.js'
import { CATEGORIES, LAYERS, STYLE_IDS } from './dataset.js'

const TRUST_THRESHOLD = 0.8

const tally = () => ({ pass: 0, total: 0 })
const add = (bucket, pass) => { bucket.total += 1; if (pass) bucket.pass += 1 }
const bucketOf = (map, key) => map[key] ?? (map[key] = tally())
export const rateOf = ({ pass, total }) => (total ? pass / total : null)

function armStats(run, arm, layerOf) {
  const stats = { overall: tally(), byItem: {}, byLayer: {}, byCategory: {}, byStyle: {}, missing: 0, judgeErrors: 0 }
  for (const judgement of run.judgements.filter((item) => item.arm === arm)) {
    if (judgement.error) { stats.judgeErrors += 1; continue }
    stats.missing += judgement.missing.length
    for (const [id, { pass }] of Object.entries(judgement.verdicts)) {
      add(stats.overall, pass)
      add(bucketOf(stats.byItem, id), pass)
      add(bucketOf(stats.byLayer, layerOf.get(id)), pass)
      add(bucketOf(stats.byCategory, judgement.category), pass)
      if (judgement.style) add(bucketOf(stats.byStyle, judgement.style), pass)
    }
  }
  const generations = run.generations.filter((item) => item.arm === arm)
  stats.generated = generations.length
  stats.generationErrors = generations.filter((item) => item.error).length
  stats.templates = generations.filter((item) => item.source === 'local_template').length
  const measured = generations.filter((item) => Number.isFinite(item.promptChars))
  stats.avgPromptChars = measured.length ? Math.round(measured.reduce((sum, item) => sum + item.promptChars, 0) / measured.length) : null
  return stats
}

function comparisonStats(comparisons) {
  const groups = {}
  for (const item of comparisons) {
    const key = `${item.left.arm} 对 ${item.right.arm}`
    const group = groups[key] ?? (groups[key] = { left: 0, right: 0, tie: 0, inconsistent: 0, error: 0 })
    group[item.outcome] += 1
  }
  return groups
}

function validationStats(validation) {
  const pairwise = { better: 0, common: 0, tie: 0, inconsistent: 0, error: 0 }
  for (const item of validation.pairwise) pairwise[item.outcome] += 1
  const catches = tally()
  const clean = tally()
  let errors = 0
  for (const item of validation.rubric) {
    if (item.error) { errors += 1; continue }
    if (item.which === 'common') {
      for (const id of item.expectedFails) {
        if (item.verdicts[id]) add(catches, item.verdicts[id].pass === false)
      }
    } else {
      for (const { pass } of Object.values(item.verdicts)) add(clean, pass)
    }
  }
  const pairTotal = validation.pairwise.length
  const accuracy = pairTotal ? pairwise.better / pairTotal : null
  return { pairwise, pairTotal, accuracy, catches, clean, errors, trusted: accuracy !== null && accuracy >= TRUST_THRESHOLD }
}

export function summarize(run) {
  const layerOf = new Map(run.rubric.items.map((item) => [item.id, item.layer]))
  const arms = Object.fromEntries(run.meta.arms.map((arm) => [arm, armStats(run, arm, layerOf)]))
  return {
    arms,
    comparisons: comparisonStats(run.comparisons),
    validation: validationStats(run.validation),
  }
}

const percent = (bucket) => {
  const rate = bucket ? rateOf(bucket) : null
  return rate === null ? '—' : `${Math.round(rate * 100)}%（${bucket.pass}/${bucket.total}）`
}
const row = (cells) => `| ${cells.join(' | ')} |`
const table = (head, rows) => [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n')

export function renderMarkdown(run, summary = summarize(run)) {
  const { meta } = run
  const arms = meta.arms
  const armName = (arm) => `${arm} ${ARMS[arm].label}`
  const { validation } = summary
  const lines = [
    `# 回复质量评测报告（${meta.mode === 'live' ? '真实调用' : '桩模式，不代表模型表现'}）`,
    '',
    `- 时间：${meta.startedAt} → ${meta.finishedAt}`,
    `- 代码：${meta.commit}`,
    `- 场景集：v${meta.scenariosVersion}（${meta.scenariosStatus === 'frozen' ? `已冻结 ${meta.scenariosFrozenAt}` : '草案，未冻结'}），${meta.caseCount} 个场景；评分标准 v${meta.rubricVersion}（${meta.rubricStatus === 'frozen' ? '已冻结' : '草案'}）`,
    `- 生成：${meta.generator}；打分：${meta.judge}`,
    ...(meta.rejudgeOf ? [`- 回复：沿用 \`${meta.rejudgeOf}\` 那一轮存下的回复，这一轮只重新打分`] : []),
    `- 分组：${arms.length ? arms.map(armName).join('、') : '（这次只自检打分模型）'}`,
    `- 调用：生成 ${meta.calls.generation} 次，打分 ${meta.calls.judge} 次；发出的提示词共 ${meta.promptChars} 字`,
  ]
  if (meta.scenariosStatus !== 'frozen' || meta.rubricStatus !== 'frozen') {
    lines.push('', '> 场景集或评分标准还是草案：这次的数字只能用来试跑，不能写进论文结论。')
  }

  lines.push('', '## 打分模型自检', '', '用每个场景手写的那一对回复检验打分模型本身准不准。', '', table(
    ['检查', '结果'],
    [
      ['两两比较时正反两次都选对「更好的那条」', `${validation.accuracy === null ? '—' : `${Math.round(validation.accuracy * 100)}%`}（${validation.pairwise.better}/${validation.pairTotal}；前后不一 ${validation.pairwise.inconsistent}，选错 ${validation.pairwise.common}，判平 ${validation.pairwise.tie}，出错 ${validation.pairwise.error}）`],
      ['常见的错误回复在它该错的条目上被判「没做到」', percent(validation.catches)],
      ['更好的回复在适用条目上被判「做到了」', percent(validation.clean)],
    ],
  ), '', validation.trusted
    ? `结论：两两比较准确率不低于 ${TRUST_THRESHOLD * 100}%，可以用它来比较各组。`
    : `结论：两两比较准确率低于 ${TRUST_THRESHOLD * 100}%，先改评分标准的措辞（要产品负责人同意），暂不比较各组。`)
  if (!arms.length) return `${lines.join('\n')}\n`

  lines.push('', '## 各组通过率', '', table(
    ['组', '全部', ...Object.values(LAYERS), '退回本地模板', '生成失败', '答不清的条目', '每次生成的提示词（字）'],
    arms.map((arm) => {
      const stats = summary.arms[arm]
      return [
        armName(arm), percent(stats.overall), ...Object.keys(LAYERS).map((layer) => percent(stats.byLayer[layer])),
        `${stats.templates}/${stats.generated}`, String(stats.generationErrors), String(stats.missing), stats.avgPromptChars === null ? '—' : String(stats.avgPromptChars),
      ]
    }),
  ))

  lines.push('', '## 逐条通过率', '', table(
    ['条目', ...arms.map(armName)],
    run.rubric.items.map((item) => [`${item.id} ${item.name}`, ...arms.map((arm) => percent(summary.arms[arm].byItem[item.id]))]),
  ))

  lines.push('', '## 按类别', '', table(
    ['类别', ...arms.map(armName)],
    Object.entries(CATEGORIES).map(([key, label]) => [label, ...arms.map((arm) => percent(summary.arms[arm].byCategory[key]))]),
  ))

  const styled = arms.filter((arm) => ARMS[arm].amie)
  if (styled.length) {
    lines.push('', '## 按说话方式', '', table(
      ['说话方式', ...styled.map(armName)],
      STYLE_IDS.map((style) => [run.rubric.styles[style], ...styled.map((arm) => percent(summary.arms[arm].byStyle[style]))]),
    ))
  }

  const comparisons = Object.entries(summary.comparisons)
  if (comparisons.length) {
    lines.push('', '## 两两比较（正反各问一次，只算前后一致的结论）', '', table(
      ['比较', '前者胜', '后者胜', '平', '前后不一', '出错'],
      comparisons.map(([key, group]) => [key, String(group.left), String(group.right), String(group.tie), String(group.inconsistent), String(group.error)]),
    ))
  }
  return `${lines.join('\n')}\n`
}
