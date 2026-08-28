import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || `${JWT_SECRET}-refresh`

// 强制指定算法，防止算法混淆攻击（alg: "none" 或 RS256 公钥伪造）
const JWT_ALGORITHM = 'HS256'

// Token 类型标识，防止 access token 和 refresh token 互换使用
const TOKEN_TYPE_ACCESS = 'access'
const TOKEN_TYPE_REFRESH = 'refresh'

// Refresh token 有效期（毫秒），用于 cookie maxAge 和数据库 expiresAt
export const REFRESH_TOKEN_AGE_MS = 30 * 24 * 60 * 60 * 1000  // 30 天

export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' })
  }

  const token = authHeader.split(' ')[1]

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] })

    // 验证 token 类型，防止 refresh token 被当作 access token 使用
    if (decoded.type !== TOKEN_TYPE_ACCESS) {
      return res.status(401).json({ error: '无效的Token类型' })
    }

    req.user = decoded
    next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token已过期，请重新登录' })
    }
    return res.status(401).json({ error: '无效的Token' })
  }
}

export function generateToken(payload) {
  return jwt.sign({ ...payload, type: TOKEN_TYPE_ACCESS }, JWT_SECRET, {
    expiresIn: '7d',
    algorithm: JWT_ALGORITHM,
  })
}

export function generateRefreshToken(payload) {
  return jwt.sign({ ...payload, type: TOKEN_TYPE_REFRESH }, JWT_REFRESH_SECRET, {
    expiresIn: '30d',
    algorithm: JWT_ALGORITHM,
  })
}

export function verifyRefreshToken(token) {
  const decoded = jwt.verify(token, JWT_REFRESH_SECRET, { algorithms: [JWT_ALGORITHM] })

  if (decoded.type !== TOKEN_TYPE_REFRESH) {
    throw new Error('无效的Refresh Token类型')
  }

  return decoded
}
