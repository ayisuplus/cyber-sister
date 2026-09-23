/**
 * 「手记」操作技能：日记（一天一篇）的查、写、删。
 * 技能对象契约见 services/moduleSkills.js；SKILL.md 的核心行为段在话题命中时注入系统块。
 */
import { skillSection } from './skillCatalog.js'
import { upsertEntry, getEntry, listMonth, deleteEntry, MOOD_LABELS } from './diaryService.js'
import { toLocalDayString } from '../utils/dayHelpers.js'
import { nativeObject, nativeString } from '../utils/toolSchema.js'

const core = skillSection('notes', '核心行为')

const today = () => toLocalDayString(new Date())

export const NOTES_SKILL = {
  id: 'notes',
  title: '手记',
  tools: {
    add_diary: {
      // 按天幂等：同一回路中同一天重复写去重（upsert 本身也是按天唯一）
      signatureOf: () => today(),
      // 今天已写过再写=覆盖正文：先出确认卡。查不到（404）就是首写，直接落库
      needsConfirm: async (userId) => {
        try {
          await getEntry(userId, today())
          return '把今天的手记改成新的说法'
        } catch (error) {
          if (error?.statusCode === 404) return false
          throw error
        }
      },
      description: '{"tool":"add_diary","args":{"content":"日记内容","mood":"可选 happy|neutral|sad|angry|anxious"}} 写今天的日记（一天一篇；今天已写过时会先请用户确认再覆盖）',
      run: async (userId, args) => {
        const entry = await upsertEntry(userId, today(), {
          content: args.content,
          mood: typeof args.mood === 'string' ? args.mood : 'neutral',
        })
        return { summary: `已记下今天的日记（${MOOD_LABELS[entry.mood]}）`, result: { day: entry.day, mood: entry.mood } }
      },
    },
    diary_status: {
      description: '{"tool":"diary_status","args":{}} 查看今天是否已写日记（只读）',
      run: async (userId) => {
        const day = today()
        try {
          const entry = await getEntry(userId, day)
          return { summary: `今天已写日记（${MOOD_LABELS[entry.mood]}）`, result: { written: true, day, mood: entry.mood } }
        } catch {
          return { summary: '今天还没写日记', result: { written: false, day } }
        }
      },
    },
    list_diary: {
      description: '{"tool":"list_diary","args":{"day":"可选 yyyy-MM-dd，查那一天","month":"可选 yyyy-MM，查整月"}} 看手记：某天的一篇或某月的日记（只读）；都缺省查今天',
      run: async (userId, args) => {
        if (args.month) {
          const entries = await listMonth(userId, args.month)
          return { summary: `看了你 ${args.month} 的日记`, result: { month: args.month, entries } }
        }
        const day = args.day || today()
        try {
          const entry = await getEntry(userId, day)
          return { summary: `看了你 ${day} 的日记`, result: { written: true, day, entry } }
        } catch (error) {
          if (error?.statusCode !== 404) throw error
          return { summary: `看了你 ${day} 的日记`, result: { written: false, day } }
        }
      },
    },
    delete_diary: {
      needsConfirm: (_userId, args) => `删掉 ${args.day || '这天'} 的手记`,
      description: '{"tool":"delete_diary","args":{"day":"yyyy-MM-dd"}} 删除那一天的日记（需要用户确认）',
      run: async (userId, args) => {
        await deleteEntry(userId, args.day)
        return { summary: `已删掉 ${args.day} 的手记`, result: { day: String(args.day || '') } }
      },
    },
  },
  toolParameters: {
    add_diary: nativeObject({ content: nativeString, mood: { type: 'string', enum: ['happy', 'neutral', 'sad', 'angry', 'anxious'] } }, ['content']),
    diary_status: nativeObject({}),
    list_diary: nativeObject({ day: nativeString, month: nativeString }),
    delete_diary: nativeObject({ day: nativeString }, ['day']),
  },
  buildContext(text, _history = [], scene = 'chat') {
    if (scene !== 'chat' || typeof text !== 'string') return []
    if (!/手记|日记|心情日记|今天的心情/.test(text)) return []
    return [{ role: 'system', content: `[Amie 内置技能：手记 v1]\n${core}` }]
  },
}
