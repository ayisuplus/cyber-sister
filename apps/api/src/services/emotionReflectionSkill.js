import { readSkillResource } from './skillCatalog.js'
import { loadBook, selectCards } from './bookShelf.js'

const read = (file) => readSkillResource('emotion-reflection', file)
const core = read('SKILL.md').split('## 核心行为')[1].split('## 方法取舍')[0].trim()
const glossary = read('glossary.md')
const declined = (text) => /不要.{0,8}(心理分析|分析我|分析我的|用克莱因)|别分析|只想.{0,4}(倾听|听我说)|不想.{0,4}分析/.test(text)
const theoryRequested = (text) => /克莱因|嫉羡与感恩|投射性认同|抑郁位置|分裂机制/.test(text)

// 章节与关键词在 skills/emotion-reflection/chapters/*.md 的文首；这里只留这本书自己的规则
export const emotionReflectionBook = loadBook('emotion-reflection', {
  // 她明确不要分析，包括接在已选话题后面说的，整本不翻
  declined,
  followUp: /^(那|那我|这个|这种情况)?(怎么办|怎么处理|还有呢|继续说|能举个例子吗)[？?。！!]*$/,
  triggered: (text) => theoryRequested(text) || /情绪与关系梳理/.test(text),
  render: (cards, text) => [{
    role: 'system',
    content: `[Amie 内置技能：情绪与关系梳理 v1]\n选择性改编自克莱因《嫉羡与感恩》，理论参考，不是诊断或治疗。\n${core}\n\n${cards.map(({ content }) => content).join('\n\n')}\n${theoryRequested(text) ? glossary : ''}\n理论出处：Melanie Klein Trust https://melanie-klein-trust.org.uk/theory/envy/ （2026-09-14 核对，仅支持理论归属，不代表临床验证）。`,
  }],
})

/** 只看这一本书时拼出的 system 块。 */
export function buildEmotionReflectionContext(text, history = [], scene = 'chat') {
  return selectCards([emotionReflectionBook], { text, history, scene }).flatMap(({ book, cards }) => book.render(cards, text))
}
