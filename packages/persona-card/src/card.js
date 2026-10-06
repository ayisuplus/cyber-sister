/**
 * 人设卡（路线图 C30）的字段、上限、标签与结构校验：零依赖纯函数。
 *
 * API（保存与蒸馏的校验权威）与 Web（表单预校验）共用这一份。
 * 「只做女孩子」「拒绝低俗」两道启发式只在服务端（apps/api personaStudio）：它们是词面正则，拦不全，
 * 不该在浏览器里再抄一份。
 *
 * v2「深度」字段（来源、表达、判断规则、心智模型、价值观、矛盾、诚实边界）在 depth.js，全部可选，
 * 旧卡与手写卡原样有效。
 */
import { checkPersonaDepth } from './depth.js'

export * from './depth.js'

/** 各字段字数上限；samples 的每一条用 sample。 */
export const PERSONA_CARD_LIMITS = Object.freeze({
  name: 20,
  identity: 300,
  relationship: 200,
  speech: 400,
  thinking: 400,
  decisions: 300,
  never: 300,
  sample: 80,
})
export const MAX_SAMPLES = 5

/** 「造一个她」的素材上限：文字 5000 字、图片最多 4 张（蒸馏草稿用，不落库）。 */
export const MAX_MATERIAL_CHARS = 5000
export const MAX_DISTILL_IMAGES = 4

/** 表单与错误文案共用的字段标签（顺序即校验顺序）。 */
export const PERSONA_FIELD_LABELS = Object.freeze({
  name: '她叫什么',
  identity: '她是谁',
  relationship: '她和你什么关系',
  speech: '她怎么说话',
  thinking: '她怎么看事情',
  decisions: '她遇事怎么判断',
  never: '她绝不做什么',
})
export const SAMPLE_LABEL = '示例句'
export const REQUIRED_FIELDS = Object.freeze(['name', 'speech'])

export const IMMERSIONS = Object.freeze(['low', 'medium', 'high'])
export const TONES = Object.freeze(['gentle', 'toxic', 'cool'])
const IMMERSION_LABEL = '沉浸深度'
const TONE_LABEL = '口吻底子'

export const MALE_REFUSAL = '这是闺蜜产品，不开展男性的服务'
export const VULGAR_REFUSAL = '这段写得有点太过了，改一改'

function readEnum(value, allowed, fallback, label, lenient) {
  const picked = (typeof value === 'string' ? value.trim() : '') || fallback
  if (allowed.includes(picked)) return { value: picked }
  if (lenient) return { value: fallback }
  return { error: `${label}必须是以下值之一: ${allowed.join(', ')}` }
}

/**
 * 归一化（trim、samples 去空）+ 结构校验：必填、各字段上限、示例句条数与字数、沉浸深度与口吻底子的枚举。
 * 校验顺序固定：字段（按 PERSONA_FIELD_LABELS 的顺序）→ 示例句 → 枚举，第一个不过的就是错误。
 * 之后是 v2 深度字段（checkPersonaDepth）：给了才进结果，没给就和旧卡一模一样。
 * 通过返回 { card }，不通过返回 { error }（可直接展示的文案）。
 *
 * lenient（表单预校验用）：枚举缺省或不认识时回落默认值，不当作错误；服务端不传，枚举不对就拒绝。
 */
export function checkPersonaCard(input, { lenient = false } = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const card = {}
  for (const [field, label] of Object.entries(PERSONA_FIELD_LABELS)) {
    const value = typeof source[field] === 'string' ? source[field].trim() : ''
    if (!value && REQUIRED_FIELDS.includes(field)) return { error: `${label}不能为空` }
    if (value.length > PERSONA_CARD_LIMITS[field]) {
      return { error: `${label}不能超过${PERSONA_CARD_LIMITS[field]}个字符` }
    }
    card[field] = value
  }

  const samples = (Array.isArray(source.samples) ? source.samples : [])
    .filter((sample) => typeof sample === 'string')
    .map((sample) => sample.trim())
    .filter(Boolean)
  if (samples.length > MAX_SAMPLES) return { error: `${SAMPLE_LABEL}最多${MAX_SAMPLES}条` }
  if (samples.some((sample) => sample.length > PERSONA_CARD_LIMITS.sample)) {
    return { error: `每条${SAMPLE_LABEL}不能超过${PERSONA_CARD_LIMITS.sample}个字符` }
  }
  card.samples = samples

  const immersion = readEnum(source.immersion, IMMERSIONS, 'medium', IMMERSION_LABEL, lenient)
  if (immersion.error) return { error: immersion.error }
  card.immersion = immersion.value
  const tone = readEnum(source.tone, TONES, 'gentle', TONE_LABEL, lenient)
  if (tone.error) return { error: tone.error }
  card.tone = tone.value

  const depth = checkPersonaDepth(source)
  if (depth.error) return { error: depth.error }
  Object.assign(card, depth.depth)
  return { card }
}
