import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import { EXTERNAL_LLM_CONSENT_VERSION } from './userService.js'
import {
  checkLocalLlmState,
  getStoredLocalConfig,
  isQwenConfigured,
} from './localLlmConfigService.js'
import { generateExplanationWithModel } from './llmService.js'

const FACE_SHAPES = new Set(['oval', 'round', 'square', 'heart', 'long', 'diamond', 'unknown'])
const SKIN_TONES = new Set([
  'cool_fair', 'cool_medium', 'neutral_fair', 'neutral_medium', 'warm_fair',
  'warm_medium', 'warm_deep', 'warm_deep_dark', 'unknown',
])
const EYE_TYPES = new Set([
  'almond', 'round', 'hooded', 'monolid', 'downturned', 'upturned',
  'close_set', 'wide_set', 'unknown',
])

const LOOKS = Object.freeze({
  look_cool_water: {
    name: '清冷白开水妆',
    fallback: '用薄透底妆和低饱和色彩，干净通勤又不压五官。',
  },
  look_peach_date: {
    name: '蜜桃约会妆',
    fallback: '蜜桃色少量叠加，能提气色又保留自然轮廓。',
  },
  look_power_queen: {
    name: '气场御姐妆',
    fallback: '把修容和眼线边界画利落，气场会更稳也更有层次。',
  },
  look_fox_red: {
    name: '狐系红妆',
    fallback: '眼尾轻轻上扬并聚焦红唇，其他区域保持克制。',
  },
  look_korean: {
    name: '精致韩系妆',
    fallback: '透亮底妆搭配自然眉唇，日常精致但不会显得厚重。',
  },
  look_pure_desire: {
    name: '自然纯欲妆',
    fallback: '只在需要处薄薄修饰，保留原本肤质和自然气色。',
  },
})

const FACE_CN = {
  oval: '椭圆脸', round: '圆脸', square: '方脸', heart: '心形脸', long: '长脸',
  diamond: '菱形脸', unknown: '未知脸型',
}
const TONE_CN = {
  cool_fair: '冷白皮', cool_medium: '冷调肤色', neutral_fair: '中性浅肤色',
  neutral_medium: '中性肤色', warm_fair: '暖白皮', warm_medium: '暖调肤色',
  warm_deep: '暖深肤色', warm_deep_dark: '暖深肤色', unknown: '未知肤色',
}
const EYE_CN = {
  almond: '杏眼', round: '圆眼', hooded: '内双或肿泡眼', monolid: '单眼皮',
  downturned: '下垂眼', upturned: '上挑眼', close_set: '眼距较近',
  wide_set: '眼距较宽', unknown: '未知眼型',
}

function invalidExplainRequest() {
  const error = new HttpError('解释请求参数无效', 400)
  error.code = 'INVALID_EXPLAIN_REQUEST'
  return error
}

function normalizeExplainInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).length !== 2
    || !Object.hasOwn(input, 'features') || !Object.hasOwn(input, 'lookId')) {
    throw invalidExplainRequest()
  }
  const features = input.features
  if (!features || typeof features !== 'object' || Array.isArray(features)
    || Object.keys(features).length !== 3
    || !Object.hasOwn(features, 'faceShape')
    || !Object.hasOwn(features, 'skinTone')
    || !Object.hasOwn(features, 'eyeType')
    || !FACE_SHAPES.has(features.faceShape)
    || !SKIN_TONES.has(features.skinTone)
    || !EYE_TYPES.has(features.eyeType)
    || typeof input.lookId !== 'string'
    || !Object.hasOwn(LOOKS, input.lookId)) {
    throw invalidExplainRequest()
  }
  return { features, lookId: input.lookId, look: LOOKS[input.lookId] }
}

function trimToCodePoints(value, max = 50) {
  return Array.from(String(value ?? '').trim().replace(/\s+/g, ' ')).slice(0, max).join('')
}

function buildExplainPrompt({ features, lookId, look }) {
  return [
    '你是明确表明 AI 身份的温柔美妆老师。',
    '只根据下列规范化标签，用一句中文解释妆容技巧；不做医疗判断、不保证变美、不评价人的价值。',
    `脸型标签：${FACE_CN[features.faceShape]}`,
    `肤色标签：${TONE_CN[features.skinTone]}`,
    `眼型标签：${EYE_CN[features.eyeType]}`,
    `内置妆容：${look.name}（${lookId}）`,
    '答案不超过 50 个 Unicode 字符。',
  ].join('\n')
}

function isUnsafeExplanation(value) {
  return /(?:保证|一定)(?:变美|显白|瘦脸)|(?:诊断|治疗|药物)|(?:丑|难看|没救)/i.test(value)
}

function getConsent(userId) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { externalLlmConsent: true, externalLlmConsentVersion: true },
  })
}

export async function getLlmStatus(userId) {
  const [config, consent] = await Promise.all([getStoredLocalConfig(), getConsent(userId)])
  return {
    mode: 'local_first',
    local: {
      configured: Boolean(config?.enabled),
      state: await checkLocalLlmState(config),
    },
    externalFallback: {
      configured: isQwenConfigured(),
      consent: consent?.externalLlmConsentVersion === EXTERNAL_LLM_CONSENT_VERSION
        ? consent.externalLlmConsent
        : null,
      version: EXTERNAL_LLM_CONSENT_VERSION,
    },
  }
}

export async function explainMakeup(userId, input, requestId) {
  const normalized = normalizeExplainInput(input)
  const fallback = trimToCodePoints(normalized.look.fallback)
  const consent = await getConsent(userId)
  const allowExternal = consent?.externalLlmConsent === true
    && consent.externalLlmConsentVersion === EXTERNAL_LLM_CONSENT_VERSION
  const modelOptions = { allowExternal }
  if (allowExternal) {
    modelOptions.authorizeExternal = async () => {
      const currentConsent = await getConsent(userId)
      return currentConsent?.externalLlmConsent === true
        && currentConsent.externalLlmConsentVersion === EXTERNAL_LLM_CONSENT_VERSION
    }
  }

  try {
    const result = await generateExplanationWithModel(
      buildExplainPrompt(normalized),
      requestId,
      modelOptions,
    )
    const explanation = trimToCodePoints(result.content)
    if (!explanation || isUnsafeExplanation(explanation)) {
      return { explanation: fallback, source: 'local_template' }
    }
    return { explanation, source: result.source }
  } catch {
    return { explanation: fallback, source: 'local_template' }
  }
}
