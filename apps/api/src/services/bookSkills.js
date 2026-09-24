import { bodyCareBook } from './bodyCareSkill.js'
import { emotionReflectionBook } from './emotionReflectionSkill.js'
import { describeSelection, selectCards } from './bookShelf.js'

// 由书改编的内置技能：登记在这里的书放在同一个书架上，一句话全局最多翻两章。
// 加一本书就在这里登记一处；回复质量评测去掉「书」这一层，也只替换这一个模块。
const BOOKS = [bodyCareBook, emotionReflectionBook]

/** 这一轮翻哪几本书的哪几章。聊天链路只算一次：提示词和页边批注都用这一份。 */
export function selectBookCards({ text, history = [], scene = 'chat' } = {}) {
  return selectCards(BOOKS, { text, history, scene })
}

/** 选好的章拼成 system 消息，顺序与登记顺序一致。 */
export function buildBookSkillContexts(selection = [], text = '') {
  return selection.flatMap(({ book, cards }) => book.render(cards, text))
}

/** 选好的章写成页边批注（纯数据，随她那一段落库）。 */
export function describeBookNotes(selection = []) {
  return describeSelection(selection)
}
