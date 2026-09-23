/**
 * 「来信」操作技能：查最近来信的摘要、设写信频率。
 * 信里建议的采纳（改/删记忆、建安排）只走看信页与来信便签的确认动作，聊天里不代用户采纳。
 */
import { skillSection } from './skillCatalog.js'
import { listLetters } from './letterService.js'
import { updateProfile } from './userService.js'
import { toUtcDayString } from '../utils/dayHelpers.js'
import { nativeObject } from '../utils/toolSchema.js'

const core = skillSection('letter', '核心行为')

const clip = (text, max) => {
  const value = String(text ?? '')
  return value.length > max ? `${value.slice(0, max)}…` : value
}

export const LETTER_SKILL = {
  id: 'letter',
  title: '来信',
  tools: {
    list_letters: {
      description: '{"tool":"list_letters","args":{}} 看她最近的来信摘要（只读）：周期、写信频率、正文截断到 200 字与每条建议的标题和处理状态；整封信的阅读留在「她」页',
      run: async (userId) => {
        const letters = (await listLetters(userId)).slice(0, 5)
        return {
          summary: `最近 ${letters.length} 封来信`,
          result: { letters: letters.map((letter) => ({
            periodStart: toUtcDayString(new Date(letter.periodStart)),
            freqDays: letter.freqDays,
            content: clip(letter.content, 200),
            suggestions: (Array.isArray(letter.suggestions) ? letter.suggestions : [])
              .map((item) => ({ kind: item.kind, title: item.title, decided: item.decided ?? null })),
          })) },
        }
      },
    },
    set_letter_freq: {
      description: '{"tool":"set_letter_freq","args":{"days":"可选 3|7"}} 设她多久写一封信；不给 days 就是不写信（偏好开关，直接执行）',
      run: async (userId, args) => {
        await updateProfile(userId, { letterFreqDays: args.days ?? null })
        return args.days
          ? { summary: `写信改成每 ${args.days} 天一封`, result: { letterFreqDays: args.days } }
          : { summary: '已经不写信了', result: { letterFreqDays: null } }
      },
    },
  },
  toolParameters: {
    list_letters: nativeObject({}),
    set_letter_freq: nativeObject({ days: { type: 'integer', enum: [3, 7] } }),
  },
  buildContext(text, _history = [], scene = 'chat') {
    if (scene !== 'chat' || typeof text !== 'string') return []
    if (!/来信|她写的信|多久写一封/.test(text)) return []
    return [{ role: 'system', content: `[Amie 内置技能：来信 v1]\n${core}` }]
  },
}
