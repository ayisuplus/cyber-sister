import { describe, it, expect } from 'vitest'
import { createLoginCodes, unavailableLoginCodes } from './mobileLoginCodes.js'

describe('mobile login codes', () => {
  const phone = '13800138000'
  const fixture = () => {
    let time = 1000
    const delivered = []
    const allowed = new Set([phone])
    const codes = createLoginCodes({
      isAllowed: value => allowed.has(value),
      now: () => time, deliver: (p, code) => delivered.push({ p, code }),
    })
    return { codes, delivered, allowed, advance: ms => { time += ms } }
  }
  it('fails closed without an explicitly supplied delivery provider', () => {
    expect(() => createLoginCodes({})).toThrow()
    expect(() => unavailableLoginCodes.request(phone)).toThrow('短信服务尚未接入')
    expect(() => unavailableLoginCodes.consume(phone, '123456')).toThrow('短信服务尚未接入')
  })
  it('delivers only to the whitelist and never returns the code in the API result', async () => {
    const { codes, delivered } = fixture()
    await expect(codes.request('13900139000')).resolves.toEqual({ accepted: true, retryAfter: 60 })
    expect(delivered).toHaveLength(0)
    expect(await codes.request(phone)).toEqual({ accepted: true, retryAfter: 60 })
    expect(delivered[0]).toEqual({ p: phone, code: expect.stringMatching(/^\d{6}$/) })
  })
  it('consumes once even for parallel verifications and rechecks whitelist', async () => {
    const { codes, delivered, allowed, advance } = fixture()
    await codes.request(phone)
    const code = delivered[0].code
    expect(await Promise.all([codes.consume(phone, code), codes.consume(phone, code)])).toEqual([true, false])
    advance(61000)
    await codes.request(phone)
    allowed.clear()
    expect(await codes.consume(phone, delivered[1].code)).toBe(false)
  })
  it('expires codes, caps guesses and throttles resends', async () => {
    const { codes, delivered, advance } = fixture()
    await codes.request(phone)
    await expect(codes.request(phone)).rejects.toMatchObject({ status: 429 })
    advance(300001)
    expect(await codes.consume(phone, delivered[0].code)).toBe(false)
    await codes.request(phone)
    const valid = delivered[1].code
    const wrong = valid === '000000' ? '000001' : '000000'
    for (let i = 0; i < 5; i++) expect(await codes.consume(phone, wrong)).toBe(false)
    expect(await codes.consume(phone, valid)).toBe(false)
  })
})
