import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { allNotes, notesFor, pickNote, SPECIAL_NOTES, NOTES } from './weatherNotes'

const day = (overrides) => ({ date: '2026-09-27', condition: '多云', icon: 'partly', min: 16, max: 24, precipitation: 10, ...overrides })
const weather = (overrides = {}) => ({ place: { name: '杭州' }, current: null, today: day(), tomorrow: day({ date: '2026-09-28' }), ...overrides })

// 猫啃网糖圆体按 unicode-range 分片：把所有分片的范围并起来，就是它有的字
function roundFontCoverage() {
  const require = createRequire(import.meta.url)
  const css = readFileSync(require.resolve('@chinese-fonts/mkwtyt/dist/MaoKenTangYuan/result.css'), 'utf8')
  const covered = new Set()
  for (const [, ranges] of css.matchAll(/unicode-range:([^;}]+)/g)) {
    for (const part of ranges.split(',')) {
      const [from, to] = part.trim().replace(/^U\+/i, '').split('-').map((hex) => Number.parseInt(hex, 16))
      for (let code = from; code <= (to ?? from); code += 1) covered.add(code)
    }
  }
  return covered
}

describe('天气页的温馨提醒', () => {
  it('每一句的每个字，猫啃网糖圆体里都有', () => {
    const covered = roundFontCoverage()
    const missing = new Set()
    for (const line of allNotes()) for (const char of line) if (!covered.has(char.codePointAt(0))) missing.add(char)
    expect([...missing]).toEqual([])
  })

  it('七种天气 × 今天/明天 × 三种说话方式都有句子，而且都短', () => {
    for (const kind of ['clear', 'partly', 'cloudy', 'fog', 'rain', 'snow', 'thunder']) {
      for (const when of ['today', 'tomorrow']) {
        for (const voice of ['gentle', 'toxic', 'cool']) expect(NOTES[kind][when][voice].length).toBeGreaterThan(0)
      }
    }
    for (const line of allNotes()) expect([...line].length).toBeLessThanOrEqual(22)
  })

  it('今天与明天分开说；降温、很热、很冷先说', () => {
    expect(notesFor(weather({ today: day({ icon: 'rain' }) }), { persona: 'gentle' })).toBe(NOTES.rain.today.gentle)
    expect(notesFor(weather({ tomorrow: day({ icon: 'snow' }) }), { tomorrow: true, persona: 'gentle' })).toBe(NOTES.snow.tomorrow.gentle)
    expect(notesFor(weather({ today: day({ max: 24 }), tomorrow: day({ max: 14 }) }), { tomorrow: true, persona: 'cool' })).toBe(SPECIAL_NOTES.drop.cool)
    expect(notesFor(weather({ today: day({ max: 35 }) }), { persona: 'toxic' })).toBe(SPECIAL_NOTES.hot.toxic)
    expect(notesFor(weather({ today: day({ max: 3, icon: 'cloudy' }) }), { persona: 'gentle' })).toBe(SPECIAL_NOTES.cold.gentle)
  })

  it('旧的说话方式按温柔说；没有天气时不说', () => {
    expect(notesFor(weather(), { persona: 'sister' })).toBe(NOTES.partly.today.gentle)
    expect(notesFor(null, { persona: 'gentle' })).toEqual([])
    expect(pickNote(null, { persona: 'gentle' })).toBe('')
  })

  it('同一天打开是同一句，点一下换下一句', () => {
    const first = pickNote(weather(), { persona: 'gentle', turn: 0, dateKey: '2026-09-27' })
    expect(pickNote(weather(), { persona: 'gentle', turn: 0, dateKey: '2026-09-27' })).toBe(first)
    expect(pickNote(weather(), { persona: 'gentle', turn: 1, dateKey: '2026-09-27' })).not.toBe(first)
    expect(pickNote(weather(), { persona: 'gentle', turn: 2, dateKey: '2026-09-27' })).toBe(first)
  })
})
