// 人设库（2026-09-29 裁定：人设纯自定义）：内置说话方式预设全部下线，「她」由用户自己写人设卡。
// 字数上限、字段标签与错误口径跟 apps/api/src/services/personaStudio.js 一致（那边是校验权威）；
// web 不 import 服务端模块（会拖进 prisma 等运行时），两侧同值写死，漂移由 personas.test.js 的值守测试拦截。

/** 人设卡各字段字数上限（与后端 PERSONA_CARD_LIMITS 同值）。 */
export const PERSONA_CARD_LIMITS = {
  name: 20,
  identity: 300,
  relationship: 200,
  speech: 400,
  thinking: 400,
  decisions: 300,
  never: 300,
  sample: 80,
}
export const MAX_SAMPLES = 5

/** 造她的素材上限（与后端 personaStudio 同值）：文字 5000 字、图片最多 4 张。 */
export const MAX_MATERIAL_CHARS = 5000
export const MAX_DISTILL_IMAGES = 4

// 字段标签（与后端 FIELDS 一致）：表单 label 与预校验错误文案共用同一份，免得两处口径漂移
export const PERSONA_FIELD_LABELS = {
  name: '她叫什么',
  identity: '她是谁',
  relationship: '她和你什么关系',
  speech: '她怎么说话',
  thinking: '她怎么看事情',
  decisions: '她遇事怎么判断',
  never: '她绝不做什么',
}
export const SAMPLE_LABEL = '示例句'

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
export const REQUIRED_FIELDS = ['name', 'speech']

// 沉浸深度：角色表达方式不同，真实身份边界一致。
export const IMMERSIONS = ['low', 'medium', 'high']
export const IMMERSION_LABELS = { low: '浅', medium: '中', high: '深' }
export const IMMERSION_DESCRIPTIONS = {
  low: '被问到就承认自己是 AI。',
  medium: '平时在角色里，聊到要紧事也能出来直说。',
  high: '平时沉浸在角色里，被问到真实身份时说明自己是 AI。',
}

// 口吻底子：只影响她固定句式（关怀、来信）的底色
export const TONES = ['gentle', 'toxic', 'cool']
export const TONE_LABELS = { gentle: '温柔', toxic: '直爽', cool: '安静' }
export const TONE_NOTE = '口吻底子只影响她固定句式（关怀、来信）的底色。'

// 错误文案与后端同口径：表单预校验直接用这些句子，服务端 error 也照这个展示
export const MALE_REFUSAL = '这是闺蜜产品，不开展男性的服务'
export const VULGAR_REFUSAL = '这段写得有点太过了，改一改'
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
  for (const [field, label] of Object.entries(PERSONA_FIELD_LABELS)) {
    const value = typeof draft?.[field] === 'string' ? draft[field].trim() : ''
    if (!value && REQUIRED_FIELDS.includes(field)) return `${label}不能为空`
    if (value.length > PERSONA_CARD_LIMITS[field]) {
      return `${label}不能超过${PERSONA_CARD_LIMITS[field]}个字符`
    }
  }
  const samples = (Array.isArray(draft?.samples) ? draft.samples : [])
    .filter((sample) => typeof sample === 'string' && sample.trim())
    .map((sample) => sample.trim())
  if (samples.length > MAX_SAMPLES) return `${SAMPLE_LABEL}最多${MAX_SAMPLES}条`
  if (samples.some((sample) => sample.length > PERSONA_CARD_LIMITS.sample)) {
    return `每条${SAMPLE_LABEL}不能超过${PERSONA_CARD_LIMITS.sample}个字符`
  }
  return null
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
  return card
}
