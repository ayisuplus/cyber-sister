import { describe, expect, it } from 'vitest'
import { DEFAULT_PERSONA_ID, PERSONAS, getPersona } from './personas'
// 权威人格 ID 清单（网关侧唯一来源）。测试在 node 侧直接 import 网关纯数据模块，
// 防止 web 本地清单与网关漂移；web 运行时 bundle 不引入网关包（见 personas.js 注释）。
import { VALID_PERSONA_IDS } from '../../../../packages/llm-gateway/src/personas'

describe('personas metadata', () => {
  it('本地人格 ID 清单与网关 VALID_PERSONA_IDS 完全一致（防漂移守卫）', () => {
    expect([...PERSONAS.map(p => p.id)].sort()).toEqual([...VALID_PERSONA_IDS].sort())
    expect(VALID_PERSONA_IDS).toContain(DEFAULT_PERSONA_ID)
  })

  it('defines each persona once with the fields both surfaces need', () => {
    expect(PERSONAS.map(p => p.id)).toEqual(['toxic', 'gentle', 'rational', 'energetic', 'sister', 'cool'])
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
