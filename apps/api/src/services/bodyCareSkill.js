import { readSkillResource } from './skillCatalog.js'
import { loadBook, selectCards } from './bookShelf.js'

const read = (file) => readSkillResource('body-care', file)
const core = read('SKILL.md').split('## 核心行为')[1].split('## 方法取舍')[0].trim()
const appointment = read('patterns.md')
// 来源清单（sources.md「一般健康信息复核」）压成一句带进提示词：模型要知道出处和「按所在地为准」，不需要每轮带一串网址
const SOURCES = '一般健康信息已对照 NHS（阴道分泌物、盆腔疼痛、宫颈筛查中的自主权）与 WHO（紧急避孕、处女检测没有科学依据）的公开资料复核；英国的就医号码、筛查项目和年龄不照搬，具体安排以所在地当前官方资料和医护为准。'

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
      content: `[Amie 内置技能：身体呵护 v1]\n选择性改编自六层楼《女生呵护指南》(2019)，不是作者本人或医疗服务。\n${core}\n\n${references.join('\n\n')}\n\n${SOURCES}`,
    }]
  },
})

/** 只看这一本书时拼出的 system 块。 */
export function buildBodyCareContext(text, history = [], scene = 'chat') {
  return selectCards([bodyCareBook], { text, history, scene }).flatMap(({ book, cards }) => book.render(cards, text))
}
