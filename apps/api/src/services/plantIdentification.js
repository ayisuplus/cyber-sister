/**
 * 花草图鉴的识别结果（路线图 C26）：一份形状，两处用——解析模型的回答，以及收进图鉴时再校验一遍前端带回来的结果。
 * 只截断、不改写：字段超长就截，形状不对就丢，认不出东西就返回 null。
 */

export const LIKELIHOODS = ['很像', '可能是', '拿不准']
export const MAX_CANDIDATES = 3
const LIMITS = {
  name: 40,
  scientificName: 80,
  family: 40,
  caution: 160,
  promptVersion: 40,
  identifiedBy: 80,
}
// 她的讲解：是什么、怎么认、什么时候开、民间说法、想养的话
export const EXPLANATION_FIELDS = { what: 200, howToTell: 200, season: 120, lore: 200, care: 200 }

/** 去掉首尾空白，按字（不是按 UTF-16 码元）截到 max；不是字符串或空串返回 null。 */
export function clip(value, max) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const chars = Array.from(trimmed)
  return chars.length > max ? chars.slice(0, max).join('') : trimmed
}

function normalizeCandidate(raw) {
  if (!raw || typeof raw !== 'object') return null
  const name = clip(raw.name, LIMITS.name)
  if (!name) return null
  return {
    name,
    scientificName: clip(raw.scientificName, LIMITS.scientificName),
    family: clip(raw.family, LIMITS.family),
    likelihood: LIKELIHOODS.includes(raw.likelihood) ? raw.likelihood : '拿不准',
  }
}

function normalizeExplanation(raw) {
  if (!raw || typeof raw !== 'object') return null
  const explanation = {}
  for (const [key, max] of Object.entries(EXPLANATION_FIELDS)) explanation[key] = clip(raw[key], max)
  return Object.values(explanation).some(Boolean) ? explanation : null
}

/**
 * @returns {null | {
 *   isPlant: boolean,
 *   candidates: Array<{ name: string, scientificName: string|null, family: string|null, likelihood: string }>,
 *   explanation: null | Record<keyof EXPLANATION_FIELDS, string|null>,
 *   caution: string|null, promptVersion: string|null, identifiedBy: string|null,
 * }}
 */
export function normalizeIdentification(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const meta = {
    promptVersion: clip(raw.promptVersion, LIMITS.promptVersion),
    identifiedBy: clip(raw.identifiedBy, LIMITS.identifiedBy),
  }
  if (raw.isPlant === false) {
    return { isPlant: false, candidates: [], explanation: null, caution: null, ...meta }
  }
  const candidates = (Array.isArray(raw.candidates) ? raw.candidates : [])
    .map(normalizeCandidate)
    .filter(Boolean)
    .slice(0, MAX_CANDIDATES)
  if (!candidates.length) return null
  return {
    isPlant: true,
    candidates,
    explanation: normalizeExplanation(raw.explanation),
    caution: clip(raw.caution, LIMITS.caution),
    ...meta,
  }
}
