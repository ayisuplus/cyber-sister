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

// ---- 识别提示词（改了规则就升版本号，评测与收藏记录都会带上它）----

export const PLANT_ID_PROMPT_VERSION = 'plant-id-v1'
export const IDENTIFY_ASK = '帮我认认照片里这是什么花草。'

export const PLANT_ID_PROMPT = `【认花草】她拍了一张照片，想知道这是什么花草。只输出一个 JSON 对象，不要任何别的文字，也不要 Markdown 代码块。
形状：
{"isPlant": true, "candidates": [{"name": "中文常用名", "scientificName": "拉丁学名", "family": "科（中文）", "likelihood": "很像"}], "explanation": {"what": "", "howToTell": "", "season": "", "lore": "", "care": ""}, "caution": null}
规则：
1. 照片里主要的东西不是植物（人、宠物、食物、物品，或者植物小到看不清）时，只输出 {"isPlant": false}。
2. candidates 最多 3 个，最像的放第一个；likelihood 只能是「很像」「可能是」「拿不准」之一。拿不准就老实标「拿不准」，不要为了显得懂而硬认；学名或科不确定就给 null。
3. explanation 照第一个候选写，用你平时跟她说话的口吻，每段一两句、不超过 60 字：
   - what：它是什么、平时在哪儿能见到；
   - howToTell：照片里看得到的哪几处让你认出它（花瓣、叶形、叶脉、花序……），照片里看不到的不要说成看到了；
   - season：什么时候开花或最好看；
   - lore：花语或民间说法，要写明是民间说法；没有就给 null；
   - care：她想在宿舍或家里养的话，最要紧的一两条；不适合家养就直说。
4. 绝不说它能吃、能泡水喝、能入药或有什么疗效，也不给偏方。
5. 菌菇、蘑菇一律不判断能不能吃，caution 写：认错的后果很重，别吃，也别让猫狗碰。
6. 任何一个候选对人或猫狗有毒、汁液刺激皮肤、花粉容易过敏时，caution 用一句话提醒她；都没有就给 null。
7. 不评价照片拍得好不好，不说教，不问她问题。`

// ---- 输出之后再兜一道：模型偶尔不听话，这几条在代码里保证 ----

// 说能吃、能泡、能入药（同一小句里前面有「别 / 不能 / 切勿」的是劝阻，不算；「不仅 / 不过 / 不少」这类不是否定）
const EDIBLE_CLAIM = /可以吃|能吃|可食用|好吃|做菜|炒着吃|泡水|泡茶|煮水|入药|药用|药效|疗效|治疗|偏方|清热解毒/g
const NEGATION = /不(?!仅|但|光|只|过|少|同|错|久)|别|勿|禁止|没法/
const CLAUSE_BREAK = /[，。！？；,.!?;、\n]/
const FUNGI = /菌|菇|蘑|Fungi|Agaric|Boletus|Amanita/i
export const FUNGI_CAUTION = '菌菇认错的后果很重：不管它像什么，都别吃，也别让猫狗碰。'

export function claimsEdible(text) {
  for (const match of String(text ?? '').matchAll(EDIBLE_CLAIM)) {
    const before = text.slice(Math.max(0, match.index - 8), match.index)
    const clause = before.split(CLAUSE_BREAK).pop()
    if (!NEGATION.test(clause)) return true
  }
  return false
}

const looksFungal = (candidates) => candidates.some((candidate) => [candidate.name, candidate.scientificName, candidate.family].some((value) => value && FUNGI.test(value)))

/**
 * 模型的回答解析出来之后再过一遍：
 * - 讲解每段、提醒都过回复同款的红线判断（unsafe 由调用方传入，免得这里依赖模型服务）；
 * - 说能吃、能入药的那一段整段去掉；
 * - 候选里像菌菇的：提醒换成固定那句，「想养的话」去掉。
 * @param {ReturnType<typeof normalizeIdentification>} result
 * @param {{ unsafe?: (text: string) => boolean }} [options]
 */
export function applyPlantSafety(result, { unsafe = () => false } = {}) {
  if (!result?.isPlant) return result
  const keep = (text) => (text && !unsafe(text) && !claimsEdible(text) ? text : null)
  let explanation = null
  if (result.explanation) {
    explanation = Object.fromEntries(Object.entries(result.explanation).map(([key, value]) => [key, keep(value)]))
    if (!Object.values(explanation).some(Boolean)) explanation = null
  }
  let caution = result.caution && !unsafe(result.caution) ? result.caution : null
  if (looksFungal(result.candidates)) {
    caution = FUNGI_CAUTION
    if (explanation) explanation = { ...explanation, care: null }
  }
  return { ...result, explanation, caution }
}
