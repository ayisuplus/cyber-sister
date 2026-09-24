import { skillSection } from './skillCatalog.js'
import { loadBook, selectCards } from './bookShelf.js'

const core = skillSection('emotional-first-aid', '核心行为')
// 她只想说说、不要方法时整本不翻：这本书讲的都是处理办法
const declined = (text) => /不要.{0,4}(建议|方法|分析|道理)|别给我.{0,4}(建议|方法|道理)|只想.{0,4}(倾诉|说说|听我说|有人听)|不想.{0,4}(听建议|听道理|被分析)/.test(text)

// 章节与关键词在 skills/emotional-first-aid/chapters/*.md 的文首；这里只留这本书自己的规则
export const emotionalFirstAidBook = loadBook('emotional-first-aid', {
  declined,
  followUp: /^(那|那我|这个|这种情况)?(怎么办|怎么处理|我该怎么做|还有呢|继续说)[？?。！!]*$/,
  triggered: (text) => /情绪急救|盖伊·?温奇/.test(text),
  render: (cards) => [{
    role: 'system',
    content: `[Amie 内置技能：情绪急救 v1]\n选择性改编自盖伊·温奇《情绪急救》，日常心理伤口的一般处理方法，不是诊断或治疗。\n${core}\n\n${cards.map(({ content }) => content).join('\n\n')}`,
  }],
})

/** 只看这一本书时拼出的 system 块。 */
export function buildEmotionalFirstAidContext(text, history = [], scene = 'chat') {
  return selectCards([emotionalFirstAidBook], { text, history, scene }).flatMap(({ book, cards }) => book.render(cards, text))
}
