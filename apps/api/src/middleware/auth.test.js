/**
 * auth 中间件单元测试
 *
 * 覆盖场景：
 * - 正常 access token 验证通过
 * - 缺少/格式错误的 Authorization header
 * - refresh token 不能作为 access token 使用（类型区分）
 * - access token 不能作为 refresh token 使用
 * - 过期 token 返回明确错误
 * - 无效签名 token 被拒绝
 * - alg: "none" 攻击被拒绝（algorithms 限制）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'

// 必须在模块加载前设置环境变量。
// 注意：ESM 的 import 会被提升到文件顶部，普通的 process.env 赋值
// 会晚于被测模块的求值，所以这里用 vi.hoisted 保证执行顺序。
vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-access-secret'
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret'
})

const { authMiddleware, generateToken, generateRefreshToken, verifyRefreshToken } =
  await import('./auth.js')

// 构造 mock 的 req/res/next
function mockReqRes(token) {
  const req = {
    headers: {
      authorization: token ? `Bearer ${token}` : undefined,
    },
  }
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  }
  const next = vi.fn()
  return { req, res, next }
}

describe('auth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('正常流程', () => {
    it('有效的 access token 应该通过验证并设置 req.user', () => {
      const token = generateToken({ userId: 123, phone: '13800138000' })
      const { req, res, next } = mockReqRes(token)

      authMiddleware(req, res, next)

      expect(next).toHaveBeenCalledOnce()
      expect(req.user.userId).toBe(123)
      expect(req.user.phone).toBe('13800138000')
      expect(req.user.type).toBe('access')
    })
  })

  describe('缺失或格式错误的 header', () => {
    it('没有 Authorization header 应该返回 401', () => {
      const { req, res, next } = mockReqRes(null)

      authMiddleware(req, res, next)

      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })

    it('Authorization 不是 Bearer 格式应该返回 401', () => {
      const req = { headers: { authorization: 'Basic abc123' } }
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
      const next = vi.fn()

      authMiddleware(req, res, next)

      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('token 类型区分（防互换攻击）', () => {
    it('refresh token 不能作为 access token 使用', () => {
      const refreshToken = generateRefreshToken({ userId: 123 })
      const { req, res, next } = mockReqRes(refreshToken)

      authMiddleware(req, res, next)

      // refresh token 用不同 secret 签名，会验证失败；
      // 即使用同一 secret，type 检查也会拦截
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })

    it('access token 不能作为 refresh token 使用（签名层拦截）', () => {
      const accessToken = generateToken({ userId: 123 })

      // access token 用 JWT_SECRET 签名，而 verifyRefreshToken 用 JWT_REFRESH_SECRET 验证，
      // 签名不匹配，直接被拒绝 —— 这是第一层防护
      expect(() => verifyRefreshToken(accessToken)).toThrow()
    })

    it('即使签名正确，type 不是 refresh 也会被拒绝（type 层拦截）', () => {
      // 模拟攻击者拿到 refresh secret，签发一个 type=access 的 token
      const forgedToken = jwt.sign(
        { userId: 123, type: 'access' },
        process.env.JWT_REFRESH_SECRET,
        { algorithm: 'HS256' }
      )

      // 签名能通过，但 type 检查会拦截 —— 这是第二层防护
      expect(() => verifyRefreshToken(forgedToken)).toThrow('无效的Refresh Token类型')
    })
  })

  describe('过期和无效 token', () => {
    it('过期的 access token 应该返回明确的过期错误', () => {
      // 手动签发一个已过期的 token
      const expiredToken = jwt.sign(
        { userId: 123, type: 'access' },
        process.env.JWT_SECRET,
        { expiresIn: '-1s', algorithm: 'HS256' }
      )
      const { req, res, next } = mockReqRes(expiredToken)

      authMiddleware(req, res, next)

      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({ error: 'Token已过期，请重新登录' })
      expect(next).not.toHaveBeenCalled()
    })

    it('错误签名的 token 应该被拒绝', () => {
      const forgedToken = jwt.sign(
        { userId: 123, type: 'access' },
        'wrong-secret',
        { algorithm: 'HS256' }
      )
      const { req, res, next } = mockReqRes(forgedToken)

      authMiddleware(req, res, next)

      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({ error: '无效的Token' })
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('算法混淆攻击防护', () => {
    it('alg: "none" 的伪造 token 应该被拒绝', () => {
      // 手工构造一个 alg: none 的 token（无签名）
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
      const payload = Buffer.from(
        JSON.stringify({ userId: 999, type: 'access' })
      ).toString('base64url')
      const noneToken = `${header}.${payload}.`

      const { req, res, next } = mockReqRes(noneToken)

      authMiddleware(req, res, next)

      // 指定 algorithms: ['HS256'] 后，none 算法会被拒绝
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })
  })
})

describe('token 生成函数', () => {
  it('generateToken 生成的 token 包含 type=access', () => {
    const token = generateToken({ userId: 1 })
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] })
    expect(decoded.type).toBe('access')
  })

  it('generateRefreshToken 生成的 token 包含 type=refresh', () => {
    const token = generateRefreshToken({ userId: 1 })
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] })
    expect(decoded.type).toBe('refresh')
  })

  it('verifyRefreshToken 能正确解析有效的 refresh token', () => {
    const token = generateRefreshToken({ userId: 456 })
    const decoded = verifyRefreshToken(token)
    expect(decoded.userId).toBe(456)
    expect(decoded.type).toBe('refresh')
  })
})
