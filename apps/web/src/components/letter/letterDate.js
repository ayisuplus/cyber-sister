// 信纸上的日期：换了一天，右上角写一行「9月22日 · 夜」，像写信落款。按这台设备的本地时间。
const PARTS = [
  { end: 5, label: '凌晨' }, { end: 8, label: '清晨' }, { end: 11, label: '上午' }, { end: 13, label: '中午' },
  { end: 17, label: '午后' }, { end: 19, label: '傍晚' }, { end: 23, label: '夜' }, { end: 24, label: '深夜' },
]

const toDate = (value) => {
  const date = value ? new Date(value) : new Date()
  return Number.isNaN(date.getTime()) ? new Date() : date
}

/** 同一天吗（本地日历日） */
export function sameDay(a, b) {
  const left = toDate(a)
  const right = toDate(b)
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()
}

/** 「9月22日 · 夜」 */
export function letterDateLabel(value) {
  const date = toDate(value)
  const hour = date.getHours()
  const part = PARTS.find(({ end }) => hour < end)?.label ?? '深夜'
  return `${date.getMonth() + 1}月${date.getDate()}日 · ${part}`
}
