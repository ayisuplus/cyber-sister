import { readFileSync } from 'node:fs'

const root = new URL('../skills/emotion-reflection/', import.meta.url)
const read = (file) => readFileSync(new URL(file, root), 'utf8')
const core = read('SKILL.md').split('## 核心行为')[1].split('## 方法取舍')[0].trim()
const glossary = read('glossary.md')
const declined = (text) => /不要.{0,8}(心理分析|分析我|分析我的|用克莱因)|别分析|只想.{0,4}(倾听|听我说)|不想.{0,4}分析/.test(text)
const topics = [
  { pattern: /嫉羡|嫉妒|忌妒|眼红|攀比|比较.{0,8}(难受|焦虑)|朋友.{0,8}升职/, file: 'envy.md' },
  { pattern: /又爱又恨|爱恨|矛盾感受|又感激又|既感激又|又喜欢又讨厌|理想化|贬低|非黑即白|分裂机制|抑郁位置/, file: 'ambivalence.md' },
  { pattern: /内疚|罪疚|自责|道歉|修复关系|关系修复|伤害了.{0,6}(朋友|对方|家人)/, file: 'repair.md' },
  { pattern: /感恩|感激|接受善意|接受帮助|欠人情|忘恩负义|别人帮我/, file: 'gratitude.md' },
  { pattern: /孤独|孤单|没人懂|没有人懂|不被理解|没人理解|只有你.{0,3}懂我/, file: 'loneliness.md' },
].map((topic) => ({ ...topic, content: read(`chapters/${topic.file}`) }))

export function buildEmotionReflectionContext(text, history = [], scene = 'chat') {
  if (scene !== 'chat' || typeof text !== 'string') return []
  // Respect explicit opt-out, including when it follows a previously selected topic.
  if (declined(text)) return []
  let selected = topics.filter(({ pattern }) => pattern.test(text))
  if (!selected.length && /^(那|那我|这个|这种情况)?(怎么办|怎么处理|还有呢|继续说|能举个例子吗)[？?。！!]*$/.test(text.trim())) {
    const lastUser = history.slice().reverse().find((message) => message?.role === 'user')
    if (typeof lastUser?.content === 'string' && !declined(lastUser.content)) selected = topics.filter(({ pattern }) => pattern.test(lastUser.content))
  }
  const theoryRequested = /克莱因|嫉羡与感恩|投射性认同|抑郁位置|分裂机制/.test(text)
  if (!selected.length && !theoryRequested && !/情绪与关系梳理/.test(text)) return []
  return [{
    role: 'system',
    content: `[Amie 内置技能：情绪与关系梳理 v1]\n选择性改编自克莱因《嫉羡与感恩》，理论参考，不是诊断或治疗。\n${core}\n\n${selected.slice(0, 2).map(({ content }) => content).join('\n\n')}\n${theoryRequested ? glossary : ''}\n理论出处：Melanie Klein Trust https://melanie-klein-trust.org.uk/theory/envy/ （2026-09-14 核对，仅支持理论归属，不代表临床验证）。`,
  }]
}
