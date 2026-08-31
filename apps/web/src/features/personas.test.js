import { describe, expect, it } from 'vitest'
import { DEFAULT_PERSONA_ID, PERSONAS, getPersona } from './personas'

describe('personas metadata', () => {
  it('defines each persona once with the fields both surfaces need', () => {
    expect(PERSONAS.map(p => p.id)).toEqual(['toxic', 'gentle', 'rational'])
    for (const persona of PERSONAS) {
      expect(persona).toMatchObject({
        name: expect.any(String),
        emoji: expect.any(String),
        chatTag: expect.any(String),
        profileTag: expect.any(String),
        chatBadgeClass: expect.any(String),
        color: expect.any(String),
        surface: expect.any(String),
      })
    }
  })

  it('resolves a known persona by id', () => {
    expect(getPersona('gentle').name).toBe('温柔姐姐')
  })

  it.each([undefined, null, '', 'unknown-persona'])('falls back to the default persona for %s', (id) => {
    expect(getPersona(id).id).toBe(DEFAULT_PERSONA_ID)
  })
})
