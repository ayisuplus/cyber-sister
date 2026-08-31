import { describe, expect, it } from 'vitest'
import { FITTING_ITEMS, MAKEUP_LOOKS } from './catalogs'

// itemId 契约：string 且 ≤64 字符（POST /api/virtual/image-gen/generations）
describe('virtual studio catalogs', () => {
  it('provides makeup looks with stable unique ids inside the API contract', () => {
    expect(MAKEUP_LOOKS.length).toBeGreaterThanOrEqual(5)
    const ids = MAKEUP_LOOKS.map(look => look.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const look of MAKEUP_LOOKS) {
      expect(typeof look.id).toBe('string')
      expect(look.id.length).toBeLessThanOrEqual(64)
      expect(look.name).toBeTruthy()
      expect(look.description).toBeTruthy()
      expect(look.tags.length).toBeGreaterThan(0)
    }
  })

  it('provides fitting items with categories and contract-safe ids', () => {
    expect(FITTING_ITEMS.length).toBeGreaterThanOrEqual(5)
    const ids = FITTING_ITEMS.map(item => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const item of FITTING_ITEMS) {
      expect(typeof item.id).toBe('string')
      expect(item.id.length).toBeLessThanOrEqual(64)
      expect(item.name).toBeTruthy()
      expect(item.category).toBeTruthy()
      expect(item.description).toBeTruthy()
    }
  })
})
