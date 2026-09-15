// 空白对话的开场：一份数据、一个组件（components/chat/Openers.jsx）。
// 随口聊的话题一点即发；身体与情绪话题只填进输入框、改好再发——敏感话题不替用户开口，也不覆盖已有输入。
// 身体/情绪文案沿用原聊天预设的措辞：只做科普、就诊准备和感受梳理，不诊断、不索要隐私。

const CASUAL = [
  { id: 'mood', label: '今天心情不好', text: '今天心情不好' },
  { id: 'movie', label: '推荐个电影', text: '推荐个电影' },
]

const BODY = [
  { id: 'period', label: '经期困扰', text: '我想聊聊经期困扰，先帮我梳理需要关注的变化，再看看有哪些问题适合问医生。' },
  { id: 'discharge', label: '分泌物与清洁', text: '我想了解白带和日常清洁，帮我分清正常现象、常见误区和需要就诊的变化。' },
  { id: 'report', label: '看懂报告', text: '我想梳理一份妇科报告。请先告诉我应遮去哪些个人信息，再帮我区分报告描述和需要问医生的问题。' },
  { id: 'protection', label: '避孕与防护', text: '我想了解避孕与身体防护，请先帮我区分日常知识、紧急补救和需要专业评估的情况。' },
  { id: 'appointment', label: '就诊准备', text: '我有点害怕妇科检查，想准备就诊问题清单，也想知道怎么向医护表达不适和要求暂停。' },
  { id: 'autonomy', label: '身体焦虑', text: '我想聊聊身体焦虑和私处外观带来的压力，先听听我的担心，不急着替我判断或推荐产品。' },
].map(topic => ({ ...topic, draft: true }))

const EMOTION = [
  { id: 'envy', label: '比较与嫉羡', text: '我想聊聊比较和嫉羡带来的难受。先听具体发生了什么，再帮我区分感受、猜测和想要的改变。' },
  { id: 'ambivalence', label: '爱恨交织', text: '我对一段关系有又爱又恨的矛盾感受。帮我分别看清珍惜的部分和受伤的部分，不急着替我决定去留。' },
  { id: 'repair', label: '内疚与修复', text: '我想梳理内疚与修复关系的问题。先核实具体发生的事和我的责任，不把内疚感直接当成我有错。' },
  { id: 'gratitude', label: '接受善意', text: '我想聊聊接受善意时的感激和欠人情感，帮我分清感谢、义务和我自己的边界。' },
  { id: 'loneliness', label: '孤独与理解', text: '我想聊聊有人陪伴却仍然孤独的感觉。先听听我希望被理解的具体部分，不急着给建议。' },
].map(topic => ({ ...topic, draft: true }))

export const OPENER_POOL = { casual: CASUAL, body: BODY, emotion: EMOTION }

const localDayIndex = (date) =>
  Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 86_400_000)

/** 两个随口话题 + 一个身体话题 + 一个情绪话题：按本地日期轮换，同一天保持不变。 */
export function pickOpeners(date = new Date()) {
  const day = localDayIndex(date)
  return [...CASUAL, BODY[day % BODY.length], EMOTION[day % EMOTION.length]]
}
