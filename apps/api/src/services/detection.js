/**
 * 内容检测模块
 *
 * 集中管理危机检测与情绪检测的关键词及逻辑。
 * 关键词单独提取为常量，方便：
 * 1. 非工程人员（心理顾问、运营）审阅和补充
 * 2. 后续迁移到配置文件或热更新
 * 3. 单元测试直接引用，避免逻辑与数据耦合
 *
 * 危机检测是核心安全逻辑：高风险词触发后应中断正常对话流程，
 * 返回危机干预响应。修改关键词务必同步更新 detection.test.js。
 */

// ============ 危机检测关键词 ============
// 高风险：明确的自我伤害意图，需立即触发危机干预
export const CRISIS_HIGH_RISK = [
  '自杀',
  '想死',
  '不想活',
  '活着没意思',
  '跳楼',
  '割腕',
  '吞药自杀',
  '吃一整瓶药',
  '大量吃药',
  '吃药去死',
  '上吊',
  '自残',
  '结束生命',
  '轻生',
  '结束自己',
  '结束这一切',
  '了结自己',
  '不活了',
]

// 中风险：消极情绪表达，需要重点关注但不立即干预
export const CRISIS_MEDIUM_RISK = [
  '活着好累',
  '想消失',
  '从世界上消失',
  '不想见人',
  '没人爱我',
  '我是个废物',
  '好绝望',
]

const DEFAULT_CRISIS_RESOURCES = [
  {
    type: 'trusted_person',
    label: '联系信任的人',
    guidance: '请尽快联系一位你信任、能够陪在你身边的人。',
  },
  {
    type: 'emergency_care',
    label: '寻求当地紧急帮助',
    guidance: '如果你可能马上伤害自己，请前往最近的急诊或拨打当地紧急救援电话。',
  },
]

function configuredCrisisResources(env) {
  if (!env?.CRISIS_RESOURCES_JSON) return DEFAULT_CRISIS_RESOURCES
  try {
    const parsed = JSON.parse(env.CRISIS_RESOURCES_JSON)
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 8) return DEFAULT_CRISIS_RESOURCES
    const resources = parsed.map((resource) => ({
      type: String(resource?.type || '').slice(0, 40),
      label: String(resource?.label || '').slice(0, 80),
      guidance: String(resource?.guidance || '').slice(0, 240),
    }))
    return resources.every((resource) => resource.type && resource.label && resource.guidance)
      ? resources
      : DEFAULT_CRISIS_RESOURCES
  } catch {
    return DEFAULT_CRISIS_RESOURCES
  }
}

/**
 * 固定的服务端危机干预内容。默认不包含未经核验的热线号码；运营可通过
 * CRISIS_RESOURCES_JSON 注入已审批并记录来源的本地资源。
 */
export function getCrisisIntervention(level, env = process.env) {
  const high = level === 'high'
  return {
    level: high ? 'high' : 'medium',
    message: high
      ? '我很担心你现在的安全。请先远离可能伤害自己的物品，马上联系能够陪在你身边的人，并寻求当地紧急帮助。'
      : '听起来你正在承受很多。先不要独自扛着，请尽快联系一位信任的人陪你，并在危险加重时寻求当地紧急帮助。',
    resources: configuredCrisisResources(env),
  }
}

// ============ 情绪检测关键词 ============
// 用于给消息打情绪标签，辅助人设回复风格选择
export const EMOTION_KEYWORDS = {
  angry: ['气死', '傻逼', '垃圾', '废物', '恶心', '讨厌', '烦死', '滚', '愤怒', '生气', '靠', '操'],
  sad: ['难过', '伤心', '哭', '委屈', '心碎', '分手', '崩溃', '绝望', 'emo', '泪'],
  happy: ['开心', '高兴', '太棒', '庆祝', '升职', '脱单', '中奖', '哈哈', '绝了', '嘿嘿'],
  anxious: ['焦虑', '怎么办', '纠结', '选哪个', '要不要', '害怕', '担心', '迷茫', '慌'],
}

// 关键词与意图正则用到的全部汉字的繁体映射。新增关键词/正则用字时必须
// 同步补表，detection.test.js 的漂移守卫用例会断言每个关键词的繁体写法可命中。
const CRISIS_CHAR_NORMALIZATION = new Map([
  ['殺', '杀'], ['藥', '药'], ['樓', '楼'], ['臺', '台'], ['結', '结'],
  ['輕', '轻'], ['這', '这'], ['絕', '绝'], ['讓', '让'], ['備', '备'],
  ['殘', '残'], ['從', '从'], ['見', '见'], ['沒', '没'], ['愛', '爱'],
  ['個', '个'], ['廢', '废'], ['著', '着'], ['計', '计'], ['劃', '划'],
  ['決', '决'], ['經', '经'], ['現', '现'], ['馬', '马'], ['會', '会'],
  ['邊', '边'], ['橋', '桥'], ['頂', '顶'],
])

function normalizeCrisisText(value) {
  let normalized = value.normalize('NFKC').toLowerCase()
  for (const [source, target] of CRISIS_CHAR_NORMALIZATION) {
    normalized = normalized.replaceAll(source, target)
  }
  // 去掉空白、标点、符号、控制/格式字符（零宽、软连字符、词连接符、tag 字符）
  // 与组合记号（变体选择符等），避免“自 杀”“跳-楼”“自­杀”等拆写绕过。
  return normalized.replace(/[\s\p{P}\p{S}\p{Cc}\p{Cf}\p{Mn}]+/gu, '')
}
// 关键词的归一化结果在模块加载时预计算：detectCrisis 每条消息都会用到，
// 避免对常量关键词重复执行 NFKC + 字符映射归一化（detection.test.js 有等价性守卫）
export const NORMALIZED_HIGH_RISK = CRISIS_HIGH_RISK.map(normalizeCrisisText)
export const NORMALIZED_MEDIUM_RISK = CRISIS_MEDIUM_RISK.map(normalizeCrisisText)

const CLEAR_NON_SELF_CONTEXT = [
  /(?:新闻|报道|电影|小说|剧本|课程|论文|研究|科普|游戏).{0,16}(?:自杀|自残|轻生|想死|跳楼|割腕)/,
  /(?:自杀|自残|轻生).{0,10}(?:预防|科普|研究|报道|课程)/,
]

const CLEAR_DENIAL_CONTEXT = [
  /(?:我)?(?:没有|并不|不是|从没|从来没|不)(?:真的)?(?:想|要|打算|准备)(?:自杀|自残|轻生|去死)/,
]

const CLEAR_DENIAL_REPLACEMENT = /(?:我)?(?:没有|并不|不是|从没|从来没|不)(?:真的)?(?:想|要|打算|准备)(?:自杀|自残|轻生|去死)/g

// 亲昵语境豁免：“想死你了”≈“太想你了”，是高频口语而非危机表达。
// 在归一化后先剥离该语境，再跑意图与关键词匹配；同句中真实的自我伤害
// 表达（如“想死你了，我也想自杀”）仍会被命中。
const AFFECTIONATE_MISS_CONTEXT = /想死(?:你|你们|他|她|他们|她们|它)(?:了|啦|咯|哦|呀|啊)?/g

const HIGH_RISK_INTENT_PATTERNS = [
  /(?:我|自己|本人|俺|咱)?(?:今晚|现在|马上|等会|已经)?(?:真的|只是)?(?<!不)(?:想|要|准备|打算|计划|决定).{0,8}(?:自杀|自残|轻生|去死|死掉|结束自己|结束这一切|结束生命|了结自己|不活了)/,
  /(?:准备|打算|计划|决定|马上|现在就|今晚|已经准备好).{0,12}(?:吞药|大量吃药|吃一整瓶药|吃安眠药|割腕|上吊|跳楼|从天台跳下去|从楼顶跳下去|从桥上跳下去)/,
  /(?:天台|楼顶|窗边|桥上).{0,8}(?:想|要|准备|打算|计划|决定).{0,6}(?:跳|跳下去)/,
  /(?:吃|吞).{0,5}(?:安眠药|一整瓶药|大量药).{0,8}(?:死|结束自己|结束这一切|结束生命|轻生)/,
]

// 明确的当前本人意图必须优先于新闻、研究、影视等背景语境，避免混合表达被豁免。
const EXPLICIT_CURRENT_SELF_INTENT_PATTERNS = [
  /(?:我(?:自己)?|俺|咱|本人)(?:也|现在|目前|此刻|已经|真的|仍然|还是|就|只|都)?(?:很|好)?(?:想|要|准备|打算|计划|决定)(?:去)?(?:自杀|自残|轻生|死|死掉|去死|不活了|结束自己|结束这一切|结束生命|了结自己)/,
]

/**
 * 检测文本是否包含危机内容
 * @param {string} text 用户输入
 * @returns {'high' | 'medium' | null} 危机等级，无风险返回 null
 */
export function detectCrisis(text) {
  if (typeof text !== 'string' || !text) return null
  const normalized = normalizeCrisisText(text).replace(AFFECTIONATE_MISS_CONTEXT, '')
  if (!normalized) return null

  if (EXPLICIT_CURRENT_SELF_INTENT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'high'
  }

  const isClearNonSelfContext = CLEAR_NON_SELF_CONTEXT.some((pattern) => pattern.test(normalized))
  const isClearDenial = CLEAR_DENIAL_CONTEXT.some((pattern) => pattern.test(normalized))
  const textWithoutClearDenial = isClearDenial
    ? normalized.replace(CLEAR_DENIAL_REPLACEMENT, '')
    : normalized
  if (isClearNonSelfContext
    && !HIGH_RISK_INTENT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return null
  }
  if (isClearDenial
    && !HIGH_RISK_INTENT_PATTERNS.some((pattern) => pattern.test(textWithoutClearDenial))
    && !NORMALIZED_HIGH_RISK.some((word) => textWithoutClearDenial.includes(word))) {
    return null
  }

  if (HIGH_RISK_INTENT_PATTERNS.some((pattern) => pattern.test(normalized))) return 'high'
  if (NORMALIZED_HIGH_RISK.some((w) => normalized.includes(w))) return 'high'
  if (NORMALIZED_MEDIUM_RISK.some((w) => normalized.includes(w))) return 'medium'
  return null
}

/**
 * 检测文本的情绪倾向
 * @param {string} text 用户输入
 * @returns {'angry' | 'sad' | 'happy' | 'anxious' | 'neutral'} 情绪标签
 */
export function detectEmotion(text) {
  if (typeof text !== 'string' || !text) return 'neutral'
  for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
    if (keywords.some((w) => text.includes(w))) return emotion
  }
  return 'neutral'
}
