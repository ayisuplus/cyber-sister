import crypto from 'node:crypto'

const unavailable = () => {
  throw Object.assign(new Error('短信服务尚未接入'), { status: 503, code: 'SMS_UNAVAILABLE' })
}

// 默认没有短信供应商；测试替身只能由测试显式注入，不通过环境变量启用。
export const unavailableLoginCodes = { request: unavailable, consume: unavailable }

// 单进程内测验证码。未来接真实短信前需独立审查供应商与部署拓扑。
export function createLoginCodes({ deliver, isAllowed, now = Date.now }) {
  if (typeof deliver !== 'function' || typeof isAllowed !== 'function') throw new Error('缺少短信投递或白名单校验')
  const pending = new Map()
  const digest = (code) => crypto.createHash('sha256').update(code).digest()
  return {
    async request(phone) {
      const accepted = { accepted: true, retryAfter: 60 }
      if (!isAllowed(phone)) return accepted
      const time = now()
      for (const [key, value] of pending) if (value.expiresAt <= time) pending.delete(key)
      if (pending.get(phone)?.sentAt > time - 60000) {
        throw Object.assign(new Error('请稍后再获取验证码'), { status: 429, code: 'SMS_RATE_LIMITED' })
      }
      const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0')
      const record = { hash: digest(code), sentAt: time, expiresAt: time + 300000, attempts: 0 }
      pending.set(phone, record)
      try {
        await deliver(phone, code)
      } catch {
        if (pending.get(phone) === record) pending.delete(phone)
        unavailable()
      }
      return accepted
    },
    consume(phone, code) {
      const record = pending.get(phone)
      if (!record || record.expiresAt <= now() || !isAllowed(phone)) {
        pending.delete(phone)
        return false
      }
      record.attempts += 1
      const valid = crypto.timingSafeEqual(record.hash, digest(code))
      if (valid || record.attempts >= 5) pending.delete(phone)
      return valid
    },
  }
}
