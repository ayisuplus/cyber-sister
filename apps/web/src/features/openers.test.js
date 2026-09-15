import { describe, expect, it } from 'vitest'
import { OPENER_POOL, pickOpeners } from './openers'

describe('pickOpeners', () => {
  it('offers two casual topics plus one body and one emotion topic', () => {
    const openers = pickOpeners(new Date(2026, 8, 15, 20))

    expect(openers).toHaveLength(4)
    expect(openers.slice(0, 2).map(topic => topic.label)).toEqual(['今天心情不好', '推荐个电影'])
    expect(OPENER_POOL.body).toContainEqual(openers[2])
    expect(OPENER_POOL.emotion).toContainEqual(openers[3])
  })

  it('only sends casual topics directly; sensitive topics are editable drafts', () => {
    for (const topic of OPENER_POOL.casual) expect(topic.draft).toBeUndefined()
    for (const topic of [...OPENER_POOL.body, ...OPENER_POOL.emotion]) expect(topic.draft).toBe(true)
  })

  it('stays the same within a day and rotates across days', () => {
    const morning = pickOpeners(new Date(2026, 8, 15, 7))
    const night = pickOpeners(new Date(2026, 8, 15, 23, 59))
    const nextDay = pickOpeners(new Date(2026, 8, 16, 7))

    expect(night).toEqual(morning)
    expect(nextDay[2]).not.toEqual(morning[2])
    expect(nextDay[3]).not.toEqual(morning[3])
  })
})
