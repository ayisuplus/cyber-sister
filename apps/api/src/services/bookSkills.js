import { buildBodyCareContext } from './bodyCareSkill.js'
import { buildEmotionReflectionContext } from './emotionReflectionSkill.js'

// 由书改编的内置技能：按顺序各自判断这一句要不要带上哪几章。
// 加一本书就在这里登记一处；回复质量评测去掉「书」这一层，也只替换这一个模块。
const BOOK_SKILLS = [buildBodyCareContext, buildEmotionReflectionContext]

/** 这一轮命中的全部书籍技能块（system 消息），顺序与登记顺序一致。 */
export function buildBookSkillContexts(text, history = [], scene = 'chat') {
  return BOOK_SKILLS.flatMap((build) => build(text, history, scene))
}
