/**
 * 人设卡 v2 的「深度」部分（人设深度化计划 T3，2026-10-06）：在原来七格之上只加可选字段，
 * 旧卡与手写卡原样有效。思路借自 nuwa-skill 的提炼结构（表达风格、「如果 X 就 Y」的判断规则、
 * 心智模型及其失效条件、价值观、内在矛盾、诚实边界），但缩到陪伴产品每轮能带得起的尺寸。
 *
 * 诚实是结构里的硬要求：每条判断规则与心智模型都必须标明来源（来自素材 / 推断 / 我写的）；
 * 凡是蒸馏出来的卡（虚构角色、公众人物、朋友），边界与矛盾必填。手写的原创卡不强制，想写多简单都行。
 */

export const PERSONA_KINDS = Object.freeze(['original', 'fiction', 'public_figure', 'friend'])
/** 蒸馏出来的卡：要守诚实的最低要求，并带来源标注。 */
export const DISTILLED_KINDS = Object.freeze(['fiction', 'public_figure', 'friend'])
export const KIND_LABELS = Object.freeze({
  original: '原创',
  fiction: '虚构角色',
  public_figure: '公众人物',
  friend: '朋友',
})

export const BASES = Object.freeze(['source', 'inferred', 'authored'])
export const BASIS_LABELS = Object.freeze({ source: '来自素材', inferred: '推断', authored: '我写的' })

export const EXPRESSION_LABELS = Object.freeze({
  sentence: '句式',
  vocabulary: '用词',
  rhythm: '节奏',
  humor: '幽默',
  certainty: '确定感',
})

export const DEPTH_LIMITS = Object.freeze({
  provenanceLabel: 30,
  expression: 80,
  heuristicWhen: 60,
  heuristicThen: 100,
  modelName: 20,
  modelIdea: 100,
  modelFailsWhen: 80,
  value: 40,
  tension: 120,
  boundary: 80,
  maxHeuristics: 8,
  maxModels: 4,
  maxValues: 3,
  maxTensions: 4,
  maxBoundaries: 6,
})

/** 蒸馏出来的卡至少要有这些（nuwa 的「诚实边界 ≥3、内在矛盾 ≥2」，规则取下限）。 */
export const HONESTY_MINIMUMS = Object.freeze({ heuristics: 3, tensions: 2, boundaries: 3 })

/** v2 新增的字段名，顺序即输出顺序。 */
export const DEPTH_KEYS = Object.freeze(['provenance', 'expression', 'heuristics', 'models', 'values', 'tensions', 'boundaries'])

const clean = (value) => (typeof value === 'string' ? value.trim() : '')
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function readList(raw, { max, limit, label }) {
  const items = (Array.isArray(raw) ? raw : []).map(clean).filter(Boolean)
  if (items.length > max) return { error: `${label}最多${max}条` }
  if (items.some((item) => item.length > limit)) return { error: `每条${label}不能超过${limit}个字符` }
  return { items }
}

function readBasis(value, where) {
  const basis = clean(value)
  if (!BASES.includes(basis)) return { error: `${where}要标明来源：${BASES.map((key) => BASIS_LABELS[key]).join('、')}` }
  return { basis }
}

/** 只读 [{...}] 里的非空行；整行都空视为表单里留的空白行，丢掉。 */
function readRows(raw, keys) {
  return (Array.isArray(raw) ? raw : []).filter(isPlainObject).filter((row) => keys.some((key) => clean(row[key])))
}

function readProvenance(raw) {
  if (raw === undefined || raw === null) return { value: null }
  if (!isPlainObject(raw)) return { error: '来源格式不对' }
  const kind = clean(raw.kind) || 'original'
  if (!PERSONA_KINDS.includes(kind)) return { error: `来源类型必须是以下值之一: ${PERSONA_KINDS.join(', ')}` }
  const label = clean(raw.label)
  if (label.length > DEPTH_LIMITS.provenanceLabel) return { error: `来源名不能超过${DEPTH_LIMITS.provenanceLabel}个字符` }
  if (kind === 'public_figure' && !label) return { error: '公众人物要写明是谁' }
  // 原创是默认：不留痕，旧卡与手写卡保持原样
  if (kind === 'original') return { value: null }
  return { value: label ? { kind, label } : { kind } }
}

function readExpression(raw) {
  if (raw === undefined || raw === null) return { value: null }
  if (!isPlainObject(raw)) return { error: '表达风格格式不对' }
  const value = {}
  for (const [key, label] of Object.entries(EXPRESSION_LABELS)) {
    const text = clean(raw[key])
    if (text.length > DEPTH_LIMITS.expression) return { error: `表达·${label}不能超过${DEPTH_LIMITS.expression}个字符` }
    if (text) value[key] = text
  }
  return { value: Object.keys(value).length ? value : null }
}

function readHeuristics(raw) {
  const rows = readRows(raw, ['when', 'then'])
  if (rows.length > DEPTH_LIMITS.maxHeuristics) return { error: `判断规则最多${DEPTH_LIMITS.maxHeuristics}条` }
  const items = []
  for (const [index, row] of rows.entries()) {
    const where = `判断规则第${index + 1}条`
    const when = clean(row.when)
    const then = clean(row.then)
    if (!when || !then) return { error: `${where}要写完整：「如果……就……」` }
    if (when.length > DEPTH_LIMITS.heuristicWhen) return { error: `${where}的「如果」不能超过${DEPTH_LIMITS.heuristicWhen}个字符` }
    if (then.length > DEPTH_LIMITS.heuristicThen) return { error: `${where}的「就」不能超过${DEPTH_LIMITS.heuristicThen}个字符` }
    const basis = readBasis(row.basis, where)
    if (basis.error) return { error: basis.error }
    items.push({ when, then, basis: basis.basis })
  }
  return { items }
}

function readModels(raw) {
  const rows = readRows(raw, ['name', 'idea', 'failsWhen'])
  if (rows.length > DEPTH_LIMITS.maxModels) return { error: `心智模型最多${DEPTH_LIMITS.maxModels}个` }
  const items = []
  for (const [index, row] of rows.entries()) {
    const where = `心智模型第${index + 1}个`
    const name = clean(row.name)
    const idea = clean(row.idea)
    const failsWhen = clean(row.failsWhen)
    if (!name || !idea || !failsWhen) return { error: `${where}要写完整：名字、一句话说明、什么时候不适用` }
    if (name.length > DEPTH_LIMITS.modelName) return { error: `${where}的名字不能超过${DEPTH_LIMITS.modelName}个字符` }
    if (idea.length > DEPTH_LIMITS.modelIdea) return { error: `${where}的说明不能超过${DEPTH_LIMITS.modelIdea}个字符` }
    if (failsWhen.length > DEPTH_LIMITS.modelFailsWhen) return { error: `${where}的适用条件不能超过${DEPTH_LIMITS.modelFailsWhen}个字符` }
    const basis = readBasis(row.basis, where)
    if (basis.error) return { error: basis.error }
    items.push({ name, idea, failsWhen, basis: basis.basis })
  }
  return { items }
}

/**
 * 校验并归一化 v2 的深度字段。只把「给了且非空」的字段写进结果；什么都没给就是空对象，
 * 所以旧卡经过它输出不变。通过返回 { depth }，不通过返回 { error }。
 */
export function checkPersonaDepth(source) {
  const input = isPlainObject(source) ? source : {}
  const depth = {}

  const provenance = readProvenance(input.provenance)
  if (provenance.error) return { error: provenance.error }
  if (provenance.value) depth.provenance = provenance.value

  const expression = readExpression(input.expression)
  if (expression.error) return { error: expression.error }
  if (expression.value) depth.expression = expression.value

  const heuristics = readHeuristics(input.heuristics)
  if (heuristics.error) return { error: heuristics.error }
  if (heuristics.items.length) depth.heuristics = heuristics.items

  const models = readModels(input.models)
  if (models.error) return { error: models.error }
  if (models.items.length) depth.models = models.items

  const lists = [
    { key: 'values', max: DEPTH_LIMITS.maxValues, limit: DEPTH_LIMITS.value, label: '价值观' },
    { key: 'tensions', max: DEPTH_LIMITS.maxTensions, limit: DEPTH_LIMITS.tension, label: '内在矛盾' },
    { key: 'boundaries', max: DEPTH_LIMITS.maxBoundaries, limit: DEPTH_LIMITS.boundary, label: '诚实边界' },
  ]
  for (const { key, ...spec } of lists) {
    const list = readList(input[key], spec)
    if (list.error) return { error: list.error }
    if (list.items.length) depth[key] = list.items
  }

  // 诚实的最低要求：只管蒸馏出来的卡；手写的原创卡不强制
  if (depth.provenance && DISTILLED_KINDS.includes(depth.provenance.kind)) {
    if ((depth.heuristics?.length ?? 0) < HONESTY_MINIMUMS.heuristics) {
      return { error: `蒸馏出来的她至少要有${HONESTY_MINIMUMS.heuristics}条判断规则` }
    }
    if ((depth.tensions?.length ?? 0) < HONESTY_MINIMUMS.tensions) {
      return { error: `蒸馏出来的她至少要写出${HONESTY_MINIMUMS.tensions}处自相矛盾的地方` }
    }
    if ((depth.boundaries?.length ?? 0) < HONESTY_MINIMUMS.boundaries) {
      return { error: `蒸馏出来的她至少要写明${HONESTY_MINIMUMS.boundaries}条做不到或不知道的事` }
    }
  }
  return { depth }
}

/** 取出卡里 v2 的那几个字段（原样，不校验）：前端编辑、蒸馏回填时用，保证深度字段不会在表单里丢掉。 */
export function pickDepth(card) {
  const source = isPlainObject(card) ? card : {}
  const picked = {}
  for (const key of DEPTH_KEYS) if (source[key] !== undefined && source[key] !== null) picked[key] = source[key]
  return picked
}

/** 把一张卡里所有会进提示词或要过内容检查的文字拼成一段（含 v2 字段）：服务端的低俗检查用。 */
export function collectCardText(card) {
  const source = isPlainObject(card) ? card : {}
  const parts = []
  const push = (value) => { if (typeof value === 'string' && value.trim()) parts.push(value) }
  for (const key of ['name', 'identity', 'relationship', 'speech', 'thinking', 'decisions', 'never']) push(source[key])
  for (const sample of Array.isArray(source.samples) ? source.samples : []) push(sample)
  if (isPlainObject(source.provenance)) push(source.provenance.label)
  if (isPlainObject(source.expression)) for (const key of Object.keys(EXPRESSION_LABELS)) push(source.expression[key])
  for (const row of Array.isArray(source.heuristics) ? source.heuristics : []) if (isPlainObject(row)) { push(row.when); push(row.then) }
  for (const row of Array.isArray(source.models) ? source.models : []) if (isPlainObject(row)) { push(row.name); push(row.idea); push(row.failsWhen) }
  for (const key of ['values', 'tensions', 'boundaries']) for (const item of Array.isArray(source[key]) ? source[key] : []) push(item)
  return parts.join('\n')
}
