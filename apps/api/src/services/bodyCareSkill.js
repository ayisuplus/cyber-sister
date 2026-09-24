import { readSkillResource } from './skillCatalog.js'
import { loadBook, selectCards } from './bookShelf.js'

const read = (file) => readSkillResource('body-care', file)
const core = read('SKILL.md').split('## 核心行为')[1].split('## 方法取舍')[0].trim()
const sources = read('sources.md').split('## 一般健康信息复核')[1].split('## 不进入执行规则')[0].trim()
const appointment = read('patterns.md')

// 章节与关键词在 skills/body-care/chapters/*.md 的文首；这里只留这本书自己的规则。
// Static, reviewed product guidance. No database, cloud call or user-derived skill text.
export const bodyCareBook = loadBook('body-care', {
  // Only an explicit short follow-up may inherit the immediately preceding user topic.
  // Assistant guesses and old user history never activate the skill on a new subject.
  followUp: /^(那|那我|这个|这种情况|它)?(怎么办|怎么处理|需要检查吗|会痛吗|需要就医吗|还有呢|继续说)[？?。！!]*$/,
  triggered: (text) => /身体呵护|女生呵护指南/.test(text),
  render: (cards, text) => {
    const references = cards.map(({ content }) => content)
    if (/就诊|看医生|检查|报告/.test(text)) references.push(appointment)
    return [{
      role: 'system',
      content: `[Amie 内置技能：身体呵护 v1]\n选择性改编自六层楼《女生呵护指南》(2019)，不是作者本人或医疗服务。\n${core}\n\n${references.join('\n\n')}\n\n一般信息来源与复核 ${sources}`,
    }]
  },
})

/** 只看这一本书时拼出的 system 块。 */
export function buildBodyCareContext(text, history = [], scene = 'chat') {
  return selectCards([bodyCareBook], { text, history, scene }).flatMap(({ book, cards }) => book.render(cards, text))
}
