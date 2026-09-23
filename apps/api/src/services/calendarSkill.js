/**
 * 「日历」（安排）操作技能：记一件事、查改安排、删除须确认，以及 day_review 的单日完整图景。
 * day_review 的「那天会发生哪几件」用 packages/schedule-logic 的 occursOn（与日历页同一份判定）。
 */
import { skillSection } from './skillCatalog.js'
import {
  createScheduledReminder, queryScheduledReminders, updateScheduledReminder, deleteScheduledReminder, listScheduledRemindersOn,
} from './reminderService.js'
import { getEntry } from './diaryService.js'
import { listNotesBetween } from './readingService.js'
import { listPeriodRecords, getPeriodConsent } from './periodService.js'
import { HttpError } from '../utils/dbHelpers.js'
import { parseUtcDay, toUtcDayString, toLocalDayString } from '../utils/dayHelpers.js'
import { nativeObject, nativeString } from '../utils/toolSchema.js'

const core = skillSection('calendar', '核心行为')

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_SUMMARY_LENGTH = 60
const TASK_STATUS_VERBS = { done: '已完成', paused: '已暂停', active: '已恢复' }

const localCalendarDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

// 一次性与每年的安排（日程、倒数日、生日）附「还有几天」，按本地日历日计
const daysLeftOf = (task, now = new Date()) =>
  Math.round((localCalendarDay(new Date(task.nextFireAt)) - localCalendarDay(now)) / DAY_MS)

function clip(text, max = MAX_SUMMARY_LENGTH) {
  const value = String(text ?? '')
  return value.length > max ? `${value.slice(0, max)}…` : value
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// 经期命中判定与日历页 periodRecordOn 同一口径：没写结束日的记录按开始日起 5 天算「经期中」
function periodOn(records, dayStr) {
  const day = parseUtcDay(dayStr)
  for (const record of records) {
    const start = new Date(record.startDate)
    const end = record.endDate ? new Date(record.endDate) : new Date(start.getTime() + 5 * DAY_MS)
    if (day >= start && day <= end) {
      return { startDate: toUtcDayString(start), endDate: record.endDate ? toUtcDayString(new Date(record.endDate)) : null }
    }
  }
  return null
}

export const CALENDAR_SKILL = {
  id: 'calendar',
  title: '日历',
  tools: {
    add_task: {
      description: '{"tool":"add_task","args":{"content":"名字","freq":"once|daily|weekly|monthly|yearly，默认 once","time":"HH:mm","date":"once/yearly 必填 yyyy-MM-dd（yearly 取月日，适合生日、纪念日）","weekdays":"weekly 必填 [0-6]，0 为周日","monthDay":"monthly 必填 1-31","instruction":"可选：用户交给你到点去做的事。执行尚未接通：会保存，但到点不会自动执行，必须如实告诉用户；不填就是到点提醒"}} 记一件事：日程、倒数日、提醒、每天打卡都用它（到点应用内通知）',
      run: async (userId, args) => {
        const task = await createScheduledReminder(userId, args)
        return {
          summary: `已安排「${clip(task.content, 20)}」`,
          result: { id: task.id, freq: task.freq, nextFireAt: task.nextFireAt },
        }
      },
    },
    list_tasks: {
      description: '{"tool":"list_tasks","args":{"status":"active|paused|done|all，默认 active","offset":"非负整数，默认 0"}} 分页查看日历上的事，含 id、内容与下次时间（只读）；hasMore 为 true 时保持 status 并用 nextOffset 继续查询，不把一页当作全部结果',
      run: async (userId, args) => {
        const { items: tasks, ...page } = await queryScheduledReminders(userId, args)
        return {
          summary: `已查询${tasks.length}件事${page.hasMore ? '，还有更多' : ''}`,
          result: { ...page, items: tasks.map((t) => ({
            id: t.id, content: t.content, freq: t.freq, time: t.time,
            weekdays: t.weekdays, monthDay: t.monthDay, nextFireAt: t.nextFireAt, status: t.status,
            isTask: Boolean(t.instruction),
            ...(['once', 'yearly'].includes(t.freq) ? { daysLeft: daysLeftOf(t) } : {}),
          })) },
        }
      },
    },
    update_task: {
      description: '{"tool":"update_task","args":{"id":"事的 id","status":"可选 done（做完了）| paused（先停一停）| active（继续）","time":"可选 HH:mm","date":"可选 yyyy-MM-dd"}} 完成、暂停、继续或改期一件事',
      run: async (userId, args) => {
        const patch = {}
        for (const key of ['status', 'time', 'date']) if (args[key] !== undefined) patch[key] = args[key]
        if (Object.keys(patch).length === 0) throw new HttpError('需要 status、time 或 date 至少一项', 400)
        const task = await updateScheduledReminder(String(args.id || ''), userId, patch)
        return {
          summary: `${TASK_STATUS_VERBS[patch.status] || '已改期'}「${clip(task.content, 20)}」`,
          result: { id: task.id, status: task.status, nextFireAt: task.nextFireAt },
        }
      },
    },
    delete_task: {
      needsConfirm: () => '删掉这件事',
      description: '{"tool":"delete_task","args":{"id":"事的 id"}} 删除一件事（需要用户确认）',
      run: async (userId, args) => {
        await deleteScheduledReminder(String(args.id || ''), userId)
        return { summary: '已删除这件事', result: { id: String(args.id || '') } }
      },
    },
    day_review: {
      description: '{"tool":"day_review","args":{"date":"yyyy-MM-dd"}} 看某一天的完整图景（只读）：那天的安排、手记、读书笔记与经期。用户问「我哪天记了什么/有什么事」用它',
      run: async (userId, args) => {
        const date = String(args.date || '')
        if (!DATE_PATTERN.test(date)) throw new HttpError('日期必须是 yyyy-MM-dd 格式', 400)
        const diary = await getEntry(userId, date).catch((error) => {
          if (error?.statusCode === 404) return null
          throw error
        })
        const notes = await listNotesBetween(userId, { from: date, to: date })
        const tasks = (await listScheduledRemindersOn(userId, new Date(`${date}T00:00:00`))).map((t) => ({
          id: t.id, content: t.content, freq: t.freq, time: t.time, date: t.fireAt ? toLocalDayString(new Date(t.fireAt)) : null,
          weekdays: t.weekdays, monthDay: t.monthDay, nextFireAt: t.nextFireAt, isTask: Boolean(t.instruction),
        }))
        const result = { date, tasks, diary, notes }
        // 经期有单独同意：未同意就整体缺省 period 字段（综合查询，不报错也不提示去开同意）
        const consent = await getPeriodConsent(userId)
        if (consent.accepted) {
          const period = periodOn(await listPeriodRecords(userId), date)
          if (period) result.period = period
        }
        return { summary: `看了你 ${date} 那天`, result }
      },
    },
  },
  toolParameters: {
    add_task: nativeObject({ content: nativeString, freq: { type: 'string', enum: ['once', 'daily', 'weekly', 'monthly', 'yearly'] }, time: nativeString, date: nativeString,
      weekdays: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, maxItems: 7 }, monthDay: { type: 'integer', minimum: 1, maximum: 31 },
      instruction: nativeString }, ['content', 'time']),
    list_tasks: nativeObject({ status: { type: 'string', enum: ['active', 'paused', 'done', 'all'] }, offset: { type: 'integer', minimum: 0, maximum: 2147483647 } }),
    update_task: nativeObject({ id: nativeString, status: { type: 'string', enum: ['done', 'paused', 'active'] }, time: nativeString, date: nativeString }, ['id']),
    delete_task: nativeObject({ id: nativeString }, ['id']),
    day_review: nativeObject({ date: nativeString }, ['date']),
  },
  buildContext(text, _history = [], scene = 'chat') {
    if (scene !== 'chat' || typeof text !== 'string') return []
    if (!/日历|日程|安排|提醒我|倒数|打卡|改期/.test(text)) return []
    return [{ role: 'system', content: `[Amie 内置技能：日历 v1]\n${core}` }]
  },
}
