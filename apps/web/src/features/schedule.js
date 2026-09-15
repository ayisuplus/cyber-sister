import { differenceInCalendarDays, format } from 'date-fns'
import { zhCN } from 'date-fns/locale'

// 「安排」：日程、倒数日、提醒、每天的小习惯共用一种定时任务（后端 ScheduledReminder）。
// 带日子的（一次、每年）按「今天 / 接下来」排，例行的（每天、每周、每月）归「重复」。

export const FREQ_OPTIONS = [
  { value: 'once', label: '一次' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'yearly', label: '每年' },
]

export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

export const DATED_FREQS = ['once', 'yearly']

const byNextFire = (a, b) => new Date(a.nextFireAt).getTime() - new Date(b.nextFireAt).getTime()

/** 离下一次还有几个本地日历日；已到点未确认的为负数。 */
export const daysLeft = (task, now = new Date()) => differenceInCalendarDays(new Date(task.nextFireAt), now)

/** @param {any[]} tasks */
export function groupTasks(tasks, now = new Date()) {
  const groups = { today: [], upcoming: [], repeating: [], paused: [], done: [] }
  for (const task of [...tasks].sort(byNextFire)) {
    if (task.status === 'done') groups.done.push(task)
    else if (task.status === 'paused') groups.paused.push(task)
    else if (!DATED_FREQS.includes(task.freq)) groups.repeating.push(task)
    else if (daysLeft(task, now) <= 0) groups.today.push(task)
    else groups.upcoming.push(task)
  }
  return groups
}

const hhmm = (date) => format(date, 'HH:mm')

/** 一行说明：什么时候。 */
export function describeWhen(task, now = new Date()) {
  const next = new Date(task.nextFireAt)
  if (task.freq === 'daily') return `每天 ${task.time}`
  if (task.freq === 'weekly') return `每周${(task.weekdays ?? []).map((day) => WEEKDAY_LABELS[day]).join('、')} ${task.time}`
  if (task.freq === 'monthly') return `每月 ${task.monthDay} 号 ${task.time}`
  if (task.freq === 'yearly') return `每年 ${format(next, 'M月d日')} ${task.time}`
  const left = daysLeft(task, now)
  if (left === 0) return `今天 ${hhmm(next)}${next <= now ? ' · 已到点' : ''}`
  if (left < 0) return `${format(next, 'M月d日')} ${hhmm(next)} · 已到点`
  return format(next, 'M月d日 EEE HH:mm', { locale: zhCN })
}

/** 「接下来」右侧的倒数。 */
export const daysLeftLabel = (days) => (days === 1 ? '明天' : `还有 ${days} 天`)
