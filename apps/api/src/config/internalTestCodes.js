const PHONE = /^1[3-9]\d{9}$/
const CODE = /^\d{6}$/
const INVALID = 'INTERNAL_TEST_CODES 必须是手机号与独立验证码的 JSON 映射，或兼容的原 6 位码'

// 兼容原有单一内测码；使用 JSON 映射时不提供共用码回退。
export function parseInternalTestCodes(raw) {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (CODE.test(value)) return { sharedCode: value, codes: new Map() }
  let parsed
  try { parsed = JSON.parse(value) } catch { throw new Error(INVALID) }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(INVALID)
  const entries = Object.entries(parsed)
  if (!entries.length || entries.some(([phone, code]) => !PHONE.test(phone) || typeof code !== 'string' || !CODE.test(code))) {
    throw new Error(INVALID)
  }
  if (new Set(entries.map(([, code]) => code)).size !== entries.length) {
    throw new Error('独立验证码不能在手机号之间重复')
  }
  return { sharedCode: null, codes: new Map(entries) }
}
