// 「安排」的调度判定（纯函数、零依赖）：一条安排在某个本地日历日会不会发生、离下一次还有几天。
// apps/web/src/features/schedule.js 与 apps/api 的聊天工具共用这一份判定，任何一侧都不要再复制。

export const FREQ_OPTIONS = [
  { value: 'once', label: '一次' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'yearly', label: '每年' },
]

export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

export const DATED_FREQS = ['once', 'yearly']

const localDay = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate())

/** 离下一次还有几个本地日历日；已到点未确认的为负数。 */
export const daysLeft = (task, now = new Date()) =>
  Math.round((localDay(new Date(task.nextFireAt)).getTime() - localDay(now).getTime()) / 86400000)

/** 这条安排在这个本地日历日会不会发生：只算 active，暂停与已完成不算。 */
export function occursOn(task, date) {
  if (task.status !== 'active') return false
  const target = localDay(date)
  const next = localDay(new Date(task.nextFireAt))
  const diff = Math.round((target.getTime() - next.getTime()) / 86400000)
  switch (task.freq) {
    case 'once': return diff === 0
    case 'yearly': return date.getMonth() === new Date(task.nextFireAt).getMonth() && date.getDate() === new Date(task.nextFireAt).getDate()
    case 'weekly': return (task.weekdays ?? []).includes(date.getDay()) && diff >= -7
    case 'monthly': return date.getDate() === task.monthDay && diff >= -31
    case 'daily': return diff >= -1
    default: return false
  }
}
