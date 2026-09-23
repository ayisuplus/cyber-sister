/**
 * 一次评测的编排：先按组依次生成回复，再并发打分、两两比较、自检打分模型。
 * 生成与打分都由调用方注入（装置里接真实聊天链路与打分网关），这里不碰数据库也不碰网络。
 */
import { ARMS, planComparisons, planGenerations } from './arms.js'
import { stylesOf } from './dataset.js'
import { buildPairwiseRequest, buildRubricRequest, combineOrders, parsePairwiseVerdict, parseRubricVerdict } from './judge.js'

const VALIDATION_STYLE = 'gentle'
const errorText = (error) => String(error?.message ?? error).slice(0, 200)

/** 保序的并发 map：最多同时跑 limit 个。 */
export async function mapPool(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next
      next += 1
      // 并发池：每个 worker 串行处理自己领到的任务
      // eslint-disable-next-line no-await-in-loop
      results[index] = await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}

async function compare(judge, rubric, scenario, style, x, y) {
  const first = parsePairwiseVerdict(await judge(buildPairwiseRequest({ rubric, scenario, style, first: x, second: y })))
  const second = parsePairwiseVerdict(await judge(buildPairwiseRequest({ rubric, scenario, style, first: y, second: x })))
  return combineOrders(first, second)
}

async function judgeRubric(judge, rubric, scenario, style, reply) {
  const request = buildRubricRequest({ rubric, scenario, style, reply })
  return parseRubricVerdict(await judge(request), request.ids)
}

/**
 * @param {{ rubric: object, cases: object[], arms: string[],
 *   generate: (task: { scenario: object, arm: string, armConfig: object, style: string | null }) => Promise<{ reply?: string, source?: string }>,
 *   judge: (request: { system: string, user: string }) => Promise<string>,
 *   concurrency?: number, onProgress?: (event: object) => void }} options
 */
export async function runEvaluation({ rubric, cases, arms, generate, judge, concurrency = 4, onProgress = () => {} }) {
  const byId = new Map(cases.map((scenario) => [scenario.id, scenario]))
  const generations = []
  // 按组依次生成：切换一次组只重建一次网关；生成共用装置里的假数据库，不能并发
  for (const arm of arms) {
    for (const task of planGenerations(cases, [arm], stylesOf)) {
      const scenario = byId.get(task.caseId)
      let result
      try {
        // eslint-disable-next-line no-await-in-loop
        result = await generate({ scenario, arm, armConfig: ARMS[arm], style: task.style })
      } catch (error) {
        result = { error: errorText(error) }
      }
      const reply = typeof result.reply === 'string' && result.reply.trim() ? result.reply : null
      generations.push({
        ...task, category: scenario.category, reply, source: result.source ?? null,
        promptChars: result.promptChars ?? null, raw: result.raw ?? null, error: result.error ?? (reply ? null : '没有回复'),
      })
      onProgress({ stage: 'generate', done: generations.length })
    }
  }
  const replyOf = (arm, caseId, style) => generations.find((item) => item.arm === arm && item.caseId === caseId && item.style === style)?.reply

  const judgements = await mapPool(generations.filter((item) => item.reply), concurrency, async (item) => {
    const base = { caseId: item.caseId, category: item.category, arm: item.arm, style: item.style }
    try {
      return { ...base, ...(await judgeRubric(judge, rubric, byId.get(item.caseId), item.style, item.reply)) }
    } catch (error) {
      return { ...base, verdicts: {}, missing: [], error: errorText(error) }
    }
  })
  onProgress({ stage: 'judge', done: judgements.length })

  const comparisons = await mapPool(planComparisons(cases, arms, stylesOf), concurrency, async (pair) => {
    const scenario = byId.get(pair.caseId)
    const left = replyOf(pair.left.arm, pair.caseId, pair.left.style)
    const right = replyOf(pair.right.arm, pair.caseId, pair.right.style)
    const base = { ...pair, category: scenario.category }
    if (!left || !right) return { ...base, outcome: 'error' }
    try {
      const outcome = await compare(judge, rubric, scenario, pair.style, left, right)
      return { ...base, outcome: { x: 'left', y: 'right' }[outcome] ?? outcome }
    } catch (error) {
      return { ...base, outcome: 'error', error: errorText(error) }
    }
  })
  onProgress({ stage: 'compare', done: comparisons.length })

  // 自检：手写的那一对回复，打分模型要能分出好坏
  const pairwise = await mapPool(cases, concurrency, async (scenario) => {
    try {
      const outcome = await compare(judge, rubric, scenario, VALIDATION_STYLE, scenario.pair.better, scenario.pair.common)
      return { caseId: scenario.id, outcome: { x: 'better', y: 'common' }[outcome] ?? outcome }
    } catch (error) {
      return { caseId: scenario.id, outcome: 'error', error: errorText(error) }
    }
  })
  const rubricChecks = await mapPool(cases.flatMap((scenario) => [['better', scenario], ['common', scenario]]), concurrency, async ([which, scenario]) => {
    const base = { caseId: scenario.id, which, expectedFails: which === 'common' ? scenario.pair.commonFails : [] }
    try {
      return { ...base, ...(await judgeRubric(judge, rubric, scenario, VALIDATION_STYLE, scenario.pair[which])) }
    } catch (error) {
      return { ...base, verdicts: {}, missing: [], error: errorText(error) }
    }
  })
  onProgress({ stage: 'validate', done: pairwise.length + rubricChecks.length })

  return { generations, judgements, comparisons, validation: { pairwise, rubric: rubricChecks } }
}
