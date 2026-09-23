/**
 * 打分：拼给打分模型的请求，以及把它的回答解析回来。
 * 打分模型看不到回复来自哪一组（盲评）；逐条回答 yes / no 并附一句理由，方便事后查它有没有偏见。
 */

export const JUDGE_INSTRUCTION = [
  '你是一名严格、公正的评审，评估陪伴型 AI「Amie」对一位年轻女生说的话回得好不好。',
  '只按给出的问题逐条判断，不因为回复长、辞藻漂亮或语气热情就给高分。',
  '只输出一个 JSON 对象，不要输出任何别的文字，也不要用代码块包起来。',
].join('\n')

const YES = new Set(['yes', 'y', 'true', 'pass', '是', '做到了', '通过'])
const NO = new Set(['no', 'n', 'false', 'fail', '否', '没做到', '未通过'])

/** 她说的话（连同前几轮），打分和两两比较共用。 */
export function renderConversation(scenario) {
  const lines = (scenario.history ?? []).map((turn) => `${turn.role === 'user' ? '她' : 'Amie'}：${turn.content}`)
  if (lines.length) lines.unshift('（之前的几句）')
  lines.push(`她：${scenario.text}`)
  return lines.join('\n')
}

const styleLine = (styles, style) => (style ? styles[style] : '（没有指定说话方式）')

/** 这一条回复要答哪几个问题：没有说话方式的组（A）不答说话方式那一条。 */
export function applicableItems(rubric, scenario, style) {
  const byId = new Map(rubric.items.map((item) => [item.id, item]))
  return scenario.rubric
    .map((id) => byId.get(id))
    .filter((item) => item && (style || item.layer !== 'style'))
}

const questionOf = (item, styles, style) => item.question.replace('{style}', styleLine(styles, style))

export function buildRubricRequest({ rubric, scenario, style, reply }) {
  const items = applicableItems(rubric, scenario, style)
  const user = [
    '【她说的话】',
    renderConversation(scenario),
    '',
    `【她选的说话方式】${styleLine(rubric.styles, style)}`,
    '',
    '【要评的回复】',
    reply,
    '',
    '【逐条判断】对每个问题回答 yes（做到了）或 no（没做到），并用不超过 30 个字说明理由：',
    ...items.map((item) => `${item.id}：${questionOf(item, rubric.styles, style)}`),
    '',
    `输出格式：{${items.map((item) => `"${item.id}":{"verdict":"yes","reason":"…"}`).join(',')}}`,
  ].join('\n')
  return { ids: items.map((item) => item.id), system: JUDGE_INSTRUCTION, user }
}

export function buildPairwiseRequest({ rubric, scenario, style, first, second }) {
  const items = applicableItems(rubric, scenario, style)
  const user = [
    '【她说的话】',
    renderConversation(scenario),
    '',
    `【她选的说话方式】${styleLine(rubric.styles, style)}`,
    '',
    '【回复一】',
    first,
    '',
    '【回复二】',
    second,
    '',
    '按下面这些标准，哪一条回复整体更好？',
    ...items.map((item) => `- ${questionOf(item, rubric.styles, style)}`),
    '',
    '输出格式：{"winner":"1","reason":"不超过 30 个字"}，winner 只能是 "1"、"2" 或 "tie"。',
  ].join('\n')
  return { system: JUDGE_INSTRUCTION, user }
}

/** 从回答里取出第一个 JSON 对象；模型偶尔会在外面多说一句或包一层代码块。 */
export function extractJson(text) {
  const value = String(text ?? '')
  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(value.slice(start, end + 1))
  } catch {
    return null
  }
}

function verdictOf(raw) {
  const value = typeof raw === 'object' && raw !== null ? raw.verdict : raw
  const key = String(value ?? '').trim().toLowerCase()
  if (YES.has(key)) return true
  if (NO.has(key)) return false
  return null
}

/** 解析逐条判断：{ verdicts: { R1: { pass, reason } }, missing: [没答或答不清的条目] }。 */
export function parseRubricVerdict(text, ids) {
  const parsed = extractJson(text)
  const verdicts = {}
  const missing = []
  for (const id of ids) {
    const raw = parsed?.[id]
    const pass = verdictOf(raw)
    if (pass === null) {
      missing.push(id)
      continue
    }
    verdicts[id] = { pass, reason: String(raw?.reason ?? '').slice(0, 80) }
  }
  return { verdicts, missing }
}

/** 解析两两比较：'1' | '2' | 'tie'，看不懂就是 null。 */
export function parsePairwiseVerdict(text) {
  const winner = String(extractJson(text)?.winner ?? '').trim().toLowerCase()
  if (['1', '一', '回复一'].includes(winner)) return '1'
  if (['2', '二', '回复二'].includes(winner)) return '2'
  if (['tie', '平', '平局'].includes(winner)) return 'tie'
  return null
}

/**
 * 正反各问一次，结论一致才算数：
 * 第一次 X 在前、第二次 Y 在前；两次都选了 X 才算 X 胜，都选 Y 才算 Y 胜，都说平才算平，其余一律「前后不一」。
 */
export function combineOrders(xFirst, yFirst) {
  if (xFirst === '1' && yFirst === '2') return 'x'
  if (xFirst === '2' && yFirst === '1') return 'y'
  if (xFirst === 'tie' && yFirst === 'tie') return 'tie'
  return 'inconsistent'
}
