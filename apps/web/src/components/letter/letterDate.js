// 信纸上的日期：换了一天，右上角写一行「9月22日 · 夜」，像写信落款。按这台设备的本地时间。
// phase 给日期旁的小画用：晨（清晨）、昼、昏（傍晚）、夜（夜里到凌晨）。
/** @typedef {'dawn' | 'day' | 'dusk' | 'night'} DayPhase */
/** @type {{ end: number, label: string, phase: DayPhase }[]} */
const PARTS = [
  { end: 5, label: '凌晨', phase: 'night' }, { end: 8, label: '清晨', phase: 'dawn' }, { end: 11, label: '上午', phase: 'day' },
  { end: 13, label: '中午', phase: 'day' }, { end: 17, label: '午后', phase: 'day' }, { end: 19, label: '傍晚', phase: 'dusk' },
  { end: 23, label: '夜', phase: 'night' }, { end: 24, label: '深夜', phase: 'night' },
]
const partOf = (date) => PARTS.find(({ end }) => date.getHours() < end) ?? PARTS[PARTS.length - 1]

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
  return `${date.getMonth() + 1}月${date.getDate()}日 · ${partOf(date).label}`
}

/**
 * 这个时刻属于一天里的哪一段：dawn / day / dusk / night
 * @returns {DayPhase}
 */
export function dayPhase(value) {
  return partOf(toDate(value)).phase
}
