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
  '吃药',
  '上吊',
  '自残',
  '结束生命',
]

// 中风险：消极情绪表达，需要重点关注但不立即干预
export const CRISIS_MEDIUM_RISK = [
  '活着好累',
  '消失',
  '不想见人',
  '没人爱我',
  '我是个废物',
  '好绝望',
]

// ============ 情绪检测关键词 ============
// 用于给消息打情绪标签，辅助人设回复风格选择
export const EMOTION_KEYWORDS = {
  angry: ['气死', '傻逼', '垃圾', '废物', '恶心', '讨厌', '烦死', '滚', '愤怒', '生气', '靠', '操'],
  sad: ['难过', '伤心', '哭', '委屈', '心碎', '分手', '崩溃', '绝望', 'emo', '泪'],
  happy: ['开心', '高兴', '太棒', '庆祝', '升职', '脱单', '中奖', '哈哈', '绝了', '嘿嘿'],
  anxious: ['焦虑', '怎么办', '纠结', '选哪个', '要不要', '害怕', '担心', '迷茫', '慌'],
}

/**
 * 检测文本是否包含危机内容
 * @param {string} text 用户输入
 * @returns {'high' | 'medium' | null} 危机等级，无风险返回 null
 */
export function detectCrisis(text) {
  if (typeof text !== 'string' || !text) return null
  if (CRISIS_HIGH_RISK.some((w) => text.includes(w))) return 'high'
  if (CRISIS_MEDIUM_RISK.some((w) => text.includes(w))) return 'medium'
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
