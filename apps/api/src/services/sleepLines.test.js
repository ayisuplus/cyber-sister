import { describe, expect, it } from 'vitest'
import {
  BEDTIME_LINES, MORNING_LINES, bedtimeLineFor, describeSleepDays, formatLine, morningLineFor, morningPoolFor,
  seasonOf, shuffledBy, sleepLineFor, sourceOf,
} from './sleepLines.js'

// 北京时间某天早上 07:40（UTC 23:40 是前一天），与跑测试的机器设在哪无关
const morningOf = (day) => new Date(`${day}T07:40:00+08:00`)
const SEASONS = ['spring', 'summer', 'autumn', 'winter']
// 催活、打鸡血、套话：早安晚安里都不该出现
const BANNED = ['加油', '努力', '奋斗', '元气', '美好的一天', '正能量', '你可以的', '自律', '打卡', '效率', '坚持', '早起的鸟儿']

describe('句库的规矩', () => {
  const all = [...MORNING_LINES, ...BEDTIME_LINES]

  it('编号不重复，句子不重复', () => {
    expect(new Set(all.map((item) => item.id)).size).toBe(all.length)
    expect(new Set(all.map((item) => item.text)).size).toBe(all.length)
  })

  it('每个季节可用的早安句不少于 30 句；晚安不少于 20 句', () => {
    for (const season of SEASONS) expect(morningPoolFor(season).length).toBeGreaterThanOrEqual(30)
    expect(BEDTIME_LINES.length).toBeGreaterThanOrEqual(20)
  })

  it('古诗词都注明篇名，除《诗经》外都有作者；晚安全部原创', () => {
    const poems = MORNING_LINES.filter((item) => item.title)
    expect(poems.length).toBeGreaterThanOrEqual(30)
    for (const item of poems) {
      if (!item.author) expect(item.title.startsWith('诗经·')).toBe(true)
    }
    expect(BEDTIME_LINES.every((item) => !item.title)).toBe(true)
  })

  it('原创的与古诗词大约各占一半', () => {
    const poems = MORNING_LINES.filter((item) => item.title).length
    const ratio = poems / MORNING_LINES.length
    expect(ratio).toBeGreaterThan(0.4)
    expect(ratio).toBeLessThan(0.65)
  })

  it('不催、不打鸡血：禁词一个都没有', () => {
    for (const item of all) {
      for (const word of BANNED) expect(item.text, `${item.id} 含「${word}」`).not.toContain(word)
    }
  })

  it('季节标签只用 spring/summer/autumn/winter/any', () => {
    for (const item of MORNING_LINES) {
      expect(item.seasons.length).toBeGreaterThan(0)
      for (const season of item.seasons) expect([...SEASONS, 'any']).toContain(season)
    }
  })
})

describe('抽句', () => {
  it('北京时间的季节：3-5 春、6-8 夏、9-11 秋、12-2 冬', () => {
    expect([3, 5, 6, 8, 9, 11, 12, 1, 2].map(seasonOf)).toEqual(['spring', 'spring', 'summer', 'summer', 'autumn', 'autumn', 'winter', 'winter', 'winter'])
  })

  it('同一个人同一天总是同一句；按北京时间算日子', () => {
    const first = morningLineFor('u1', morningOf('2026-09-28'))
    expect(morningLineFor('u1', new Date('2026-09-28T09:30:00+08:00'))).toEqual(first)
    // UTC 前一天 23:40 = 北京时间当天 07:40
    expect(morningLineFor('u1', new Date('2026-09-27T23:40:00Z'))).toEqual(first)
  })

  it('一季之内先轮完再重复：连着这么多天没有一句重样', () => {
    const pool = morningPoolFor('autumn')
    const seen = new Set()
    for (let day = 0; day < pool.length; day++) {
      const at = new Date(Date.UTC(2026, 8, 1 + day, 0, 0) - 8 * 3600_000 + 7 * 3600_000)
      seen.add(morningLineFor('u1', at).id)
    }
    expect(seen.size).toBe(pool.length)
  })

  it('只从这一季能用的句子里抽', () => {
    const winterIds = new Set(morningPoolFor('winter').map((item) => item.id))
    for (let day = 1; day <= 28; day++) {
      const at = morningOf(`2027-01-${String(day).padStart(2, '0')}`)
      expect(winterIds.has(morningLineFor('u1', at).id)).toBe(true)
    }
  })

  it('冬天跨年接着轮：12 月 31 日和 1 月 1 日是同一副牌里挨着的两句', () => {
    const dec = morningLineFor('u1', morningOf('2026-12-31'))
    const jan = morningLineFor('u1', morningOf('2027-01-01'))
    const deck = shuffledBy(morningPoolFor('winter'), 'u1|2026-winter')
    const at = deck.findIndex((item) => item.id === dec.id)
    expect(deck[(at + 1) % deck.length]).toEqual(jan)
  })

  it('不同的人洗出来的顺序不一样；洗牌不改原数组', () => {
    const days = Array.from({ length: 10 }, (_, i) => morningOf(`2026-10-${String(i + 1).padStart(2, '0')}`))
    const a = days.map((at) => morningLineFor('u1', at).id)
    const b = days.map((at) => morningLineFor('u2', at).id)
    expect(a).not.toEqual(b)
    const before = MORNING_LINES.map((item) => item.id)
    shuffledBy(MORNING_LINES, 'x')
    expect(MORNING_LINES.map((item) => item.id)).toEqual(before)
  })

  it('晚安句同一天不变，一轮之内不重复', () => {
    const at = new Date('2026-09-28T23:30:00+08:00')
    expect(bedtimeLineFor('u1', at)).toEqual(bedtimeLineFor('u1', new Date('2026-09-28T23:59:00+08:00')))
    // 找到一轮的起点，连着一轮的天数没有重样
    const base = Math.floor(Date.UTC(2026, 8, 28) / 86_400_000)
    const start = base - (base % BEDTIME_LINES.length)
    const seen = new Set()
    for (let offset = 0; offset < BEDTIME_LINES.length; offset++) {
      seen.add(bedtimeLineFor('u1', new Date((start + offset) * 86_400_000 + 12 * 3600_000)).id)
    }
    expect(seen.size).toBe(BEDTIME_LINES.length)
  })
})

describe('写在便签上', () => {
  it('古诗词另起一行注出处；《诗经》不署作者；原创的就是一句', () => {
    const poem = MORNING_LINES.find((item) => item.id === 'p16')
    expect(formatLine(poem)).toBe('知否，知否？应是绿肥红瘦。\n——李清照《如梦令·昨夜雨疏风骤》')
    expect(sourceOf(MORNING_LINES.find((item) => item.id === 'p33'))).toBe('《诗经·秦风·蒹葭》')
    const own = MORNING_LINES.find((item) => item.id === 'm10')
    expect(formatLine(own)).toBe('慢慢来，今天会等你。')
    expect(sourceOf(own)).toBe('')
  })

  it('哪几天：每天 / 工作日 / 周末 / 周一、三……周日放最后', () => {
    expect(describeSleepDays({ freq: 'daily' })).toBe('每天')
    expect(describeSleepDays({ freq: 'weekly', weekdays: [5, 1, 2, 3, 4] })).toBe('工作日')
    expect(describeSleepDays({ freq: 'weekly', weekdays: [6, 0] })).toBe('周末')
    expect(describeSleepDays({ freq: 'weekly', weekdays: [0, 1, 3] })).toBe('周一、三、日')
  })

  it('早安投递配当天早上的句子；晚安投递明早开着闹钟才补一句「明早几点叫你」', () => {
    const fireAt = new Date('2026-09-28T23:30:00+08:00')
    const bedtime = { fireAt, reminder: { kind: 'bedtime' } }
    const plain = bedtimeLineFor('u1', fireAt)
    const wake = { enabled: true, time: '07:40', nextFireAt: new Date('2026-09-29T07:40:00+08:00') }
    expect(sleepLineFor(bedtime, 'u1', wake).text).toBe(`${plain.text}明早 07:40 叫你。`)
    // 明天是周六、闹钟只在工作日：下一次在两天后，不补
    expect(sleepLineFor(bedtime, 'u1', { ...wake, nextFireAt: new Date('2026-10-01T07:40:00+08:00') })).toEqual(plain)
    expect(sleepLineFor(bedtime, 'u1', { ...wake, enabled: false })).toEqual(plain)
    expect(sleepLineFor(bedtime, 'u1', null)).toEqual(plain)

    const morning = { fireAt: morningOf('2026-09-29'), reminder: { kind: 'wake' } }
    expect(sleepLineFor(morning, 'u1')).toEqual(morningLineFor('u1', morningOf('2026-09-29')))
    expect(sleepLineFor({ fireAt, reminder: { kind: 'plain' } }, 'u1')).toBeNull()
  })
})
