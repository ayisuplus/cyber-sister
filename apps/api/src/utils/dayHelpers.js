import { HttpError } from './dbHelpers.js'

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** 'yyyy-MM-dd' → UTC 零点 Date（与经期/倒数日同一存储契约）；非法输入抛 400。 */
export function parseUtcDay(dayStr) {
  if (typeof dayStr !== 'string' || !DAY_PATTERN.test(dayStr)) {
    throw new HttpError('日期必须是 yyyy-MM-dd 格式', 400)
  }
  const day = new Date(`${dayStr}T00:00:00.000Z`)
  if (Number.isNaN(day.getTime()) || toUtcDayString(day) !== dayStr) {
    throw new HttpError('日期不存在', 400)
  }
  return day
}

export function toUtcDayString(date) {
  return date.toISOString().slice(0, 10)
}

/** 今天（本地日历日）按 UTC 零点表示，与 parseUtcDay 的存储形态一致。 */
export function localTodayUtc() {
  const now = new Date()
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
}
