import { describe, expect, it } from 'vitest'
import { showsTomorrow, weatherLine, weatherTip } from './weather'

const day = (overrides) => ({ date: '2026-09-27', condition: '多云', icon: 'partly', min: 18, max: 24, precipitation: 10, ...overrides })
const weather = (overrides = {}) => ({
  place: { name: '杭州', admin1: '浙江', country: '中国' },
  current: { temperature: 21, condition: '多云', icon: 'partly' },
  today: day(),
  tomorrow: day({ date: '2026-09-28' }),
  ...overrides,
})

describe('今天还是明天', () => {
  it('18 点到清晨 5 点看明天，其余看今天', () => {
    expect([4, 5, 12, 17, 18, 23].map(showsTomorrow)).toEqual([true, false, false, false, true, true])
  })
})

describe('页头那一行', () => {
  it('白天：城市 · 此刻天气与温度', () => {
    expect(weatherLine(weather(), 10)).toEqual({ icon: 'partly', text: '杭州 · 多云 21°' })
  })

  it('白天没有此刻读数时写今天的高低温，不编一个此刻', () => {
    expect(weatherLine(weather({ current: null }), 10)).toEqual({ icon: 'partly', text: '杭州 · 多云 18–24°' })
  })

  it('晚上：明天的天气与高低温', () => {
    const line = weatherLine(weather({ tomorrow: day({ condition: '小雨', icon: 'rain', min: 8, max: 15 }) }), 23)
    expect(line).toEqual({ icon: 'rain', text: '明天 · 小雨 8–15°' })
  })

  it('没填城市或预报不全时没有这一行', () => {
    expect(weatherLine(null, 10)).toBeNull()
    expect(weatherLine({ place: null }, 10)).toBeNull()
    expect(weatherLine(weather({ tomorrow: null }), 23)).toBeNull()
  })
})

describe('卡片里的一句', () => {
  it('晚上看明天：下雨、降温', () => {
    expect(weatherTip(weather({ tomorrow: day({ icon: 'rain', precipitation: 70 }) }), 22)).toBe('明天可能下雨，出门别淋着')
    expect(weatherTip(weather({ today: day({ max: 24 }), tomorrow: day({ max: 15 }) }), 22)).toBe('明天降温了，多穿一件')
  })

  it('白天看今天：雪、热、冷', () => {
    expect(weatherTip(weather({ today: day({ icon: 'snow' }) }), 9)).toBe('今天可能下雪，路上慢慢走')
    expect(weatherTip(weather({ today: day({ max: 35 }) }), 9)).toBe('今天很热，记得多喝水')
    expect(weatherTip(weather({ today: day({ max: 3 }) }), 9)).toBe('今天挺冷的，多穿一点')
  })

  it('雨的代码但降水概率很低时不吓她', () => {
    expect(weatherTip(weather({ today: day({ icon: 'rain', precipitation: 5 }) }), 9)).toBeNull()
  })

  it('没什么值得说的就不说，也不催她做事', () => {
    expect(weatherTip(weather(), 9)).toBeNull()
    expect(weatherTip(weather(), 22)).toBeNull()
  })
})
