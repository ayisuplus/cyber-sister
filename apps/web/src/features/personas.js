// 人设库（2026-09-29 裁定：人设纯自定义）：内置说话方式预设全部下线，「她」由用户自己写人设卡。
// 字数上限、字段标签、枚举与结构校验在 packages/persona-card，API 与 Web 共用这一份（不再各抄一份再靠测试防漂移）；
// 这里再导出，组件与测试的 import 不变。男性与低俗两道启发式只在服务端。
import {
  BASES,
  BASIS_LABELS,
  DEPTH_LIMITS,
  EXPRESSION_LABELS,
  FRIEND_NEEDS_ATTESTATION,
  HONESTY_MINIMUMS,
  IMMERSIONS,
  KIND_LABELS,
  MAX_DISTILL_IMAGES,
  MAX_MATERIAL_CHARS,
  MAX_SAMPLES,
  MALE_REFUSAL,
  PERSONA_CARD_LIMITS,
  PERSONA_FIELD_LABELS,
  PUBLIC_FIGURE_NEEDS_NAME,
  REQUIRED_FIELDS,
  SAMPLE_LABEL,
  TONES,
  VULGAR_REFUSAL,
  checkPersonaCard,
  pickDepth,
} from 'persona-card'

export {
  pickDepth,
  BASES,
  BASIS_LABELS,
  DEPTH_LIMITS,
  EXPRESSION_LABELS,
  FRIEND_NEEDS_ATTESTATION,
  HONESTY_MINIMUMS,
  IMMERSIONS,
  KIND_LABELS,
  MAX_DISTILL_IMAGES,
  MAX_MATERIAL_CHARS,
  MAX_SAMPLES,
  MALE_REFUSAL,
  PERSONA_CARD_LIMITS,
  PERSONA_FIELD_LABELS,
  PUBLIC_FIGURE_NEEDS_NAME,
  REQUIRED_FIELDS,
  SAMPLE_LABEL,
  TONES,
  VULGAR_REFUSAL,
}

/** 表单字段顺序：名字、身份、关系、怎么说话、怎么看、怎么判断、绝不做什么。 */
export const PERSONA_FIELDS = [
  { field: 'name', multiline: false },
  { field: 'identity', multiline: true },
  { field: 'relationship', multiline: true },
  { field: 'speech', multiline: true },
  { field: 'thinking', multiline: true },
  { field: 'decisions', multiline: true },
  { field: 'never', multiline: true },
]

// 沉浸深度：角色表达方式不同，真实身份边界一致。
export const IMMERSION_LABELS = { low: '浅', medium: '中', high: '深' }
export const IMMERSION_DESCRIPTIONS = {
  low: '被问到就承认自己是 AI。',
  medium: '平时在角色里，聊到要紧事也能出来直说。',
  high: '平时沉浸在角色里，被问到真实身份时说明自己是 AI。',
}

// 口吻底子：只影响她固定句式（关怀、来信）的底色
export const TONE_LABELS = { gentle: '温柔', toxic: '直爽', cool: '安静' }
export const TONE_NOTE = '口吻底子只影响她固定句式（关怀、来信）的底色。'

// 错误文案与后端同口径：表单预校验直接用这些句子，服务端 error 也照这个展示
export const AT_LEAST_ONE_HER = '至少留一个她'
export const NO_SUCH_HER = '没有这个她'
export const DISTILL_FAILED = '没整理出来，你可以自己动手写'
export const DISTILL_EMPTY_MATERIAL = '先给点她的素材'

// 换她的两句结果提示：封面与「她」页共用，避免两份文案漂移
export const PERSONA_SWITCHED = '换好了，下一条消息就换她来和你说话'
export const PERSONA_SWITCH_FAILED = '没换成功，请重试'

/** 空白人设卡：手写入口与蒸馏落笔前的表单初值。 */
export const emptyPersonaCard = () => ({
  name: '',
  identity: '',
  relationship: '',
  speech: '',
  thinking: '',
  decisions: '',
  never: '',
  samples: [''],
  immersion: 'medium',
  tone: 'gentle',
})

/**
 * 列表里给她的一句示例句：先取示例句第一条，没有就截「她怎么说话」的第一句。
 * 只用来让每个她看得出是谁，不进系统提示词。
 */
export const sampleLineOf = (card) => {
  const sample = (Array.isArray(card?.samples) ? card.samples : [])
    .find((item) => typeof item === 'string' && item.trim())
  if (sample) return sample.trim()
  const speech = typeof card?.speech === 'string' ? card.speech.trim() : ''
  if (!speech) return ''
  const first = speech.match(/^[^。！？!?\n]+[。！？!?]?/)
  return (first ? first[0] : speech).trim()
}

/**
 * 表单预校验（保存前）：必填、各字段字数、示例句条数与字数；口径跟后端 validatePersonaCard 一致。
 * 返回错误文案（直接展示），通过返回 null。男性与低俗两道线保存时由服务端把关，这里只做字数与必填。
 */
export function validatePersonaCard(draft) {
  return checkPersonaCard(draft, { lenient: true }).error ?? null
}

/** 提交前的归一（与后端同口径）：trim、示例句去空、枚举缺省。 */
export function buildPersonaCard(draft) {
  const card = {}
  for (const field of Object.keys(PERSONA_FIELD_LABELS)) {
    card[field] = typeof draft?.[field] === 'string' ? draft[field].trim() : ''
  }
  card.samples = (Array.isArray(draft?.samples) ? draft.samples : [])
    .filter((sample) => typeof sample === 'string')
    .map((sample) => sample.trim())
    .filter(Boolean)
  card.immersion = IMMERSIONS.includes(draft?.immersion) ? draft.immersion : 'medium'
  card.tone = TONES.includes(draft?.tone) ? draft.tone : 'gentle'
  // v2 深度字段原样带上：表单还不认识它们时，编辑一张深度卡也不能把它们丢掉（校验在服务端）
  return { ...card, ...pickDepth(draft) }
}

// ——— 人设深度化 T6：先选她从哪来，深度字段的编辑与来源标注 ———

/** 「造一个她」先选她从哪来：来源类型决定要填什么、能不能联网查、收不收照片。 */
export const DISTILL_KINDS = [
  { kind: 'original', title: '我自己想的', hint: '你来描述她，我帮你整理成卡。' },
  { kind: 'fiction', title: '虚构角色', hint: '动漫、小说、影视里的她。可以顺手查公开资料。' },
  { kind: 'public_figure', title: '公众人物', hint: '只做女性。她是受公开言论启发的 AI，不代表本人。' },
  { kind: 'friend', title: '我的朋友', hint: '用你和在世朋友的聊天记录，只收文字：不联网，也不保存原始记录。' },
]
export const FRIEND_CLOSED = '还没开放'
export const FRIEND_ATTESTATION = '我有权使用这些聊天记录，对方是在世的朋友'

/** 只有虚构角色与公众人物有公开资料可查；自己想的不查，朋友绝不联网查人。 */
export const canResearchKind = (kind) => kind === 'fiction' || kind === 'public_figure'

/** 蒸馏前的预校验，口径与服务端一致；通过返回 null。 */
export function validateDistillSource({ kind, label, attested }) {
  const name = typeof label === 'string' ? label.trim() : ''
  if (name.length > DEPTH_LIMITS.provenanceLabel) return `来源名不能超过${DEPTH_LIMITS.provenanceLabel}个字符`
  if (kind === 'public_figure' && !name) return PUBLIC_FIGURE_NEEDS_NAME
  if (kind === 'friend' && attested !== true) return FRIEND_NEEDS_ATTESTATION
  return null
}

/** 卡上的来源标注（列表与编辑页都显示）；自己想的、旧卡没有标注，返回空串。 */
export function provenanceBadge(card) {
  const kind = card?.provenance?.kind
  const label = typeof card?.provenance?.label === 'string' ? card.provenance.label.trim() : ''
  if (kind === 'fiction') return label ? `虚构角色 · ${label}` : '虚构角色'
  if (kind === 'public_figure') return `受${label || '她'}公开言论启发的 AI，不代表本人`
  if (kind === 'friend') return '来自你提供的聊天记录'
  return ''
}

/** 卡里有没有深度内容（来源标注不算）：编辑页据此决定「更深一点的样子」默认开不开。 */
export const hasDepth = (card) => Object.keys(pickDepth(card)).some((key) => key !== 'provenance')

/** 手写加的新行，来源默认「我写的」。 */
export const blankHeuristic = () => ({ when: '', then: '', basis: 'authored' })
export const blankModel = () => ({ name: '', idea: '', failsWhen: '', basis: 'authored' })
