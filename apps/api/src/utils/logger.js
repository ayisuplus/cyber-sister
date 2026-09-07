/**
 * 结构化日志服务
 * 使用console封装，提供统一的日志接口
 */
import { randomUUID } from 'node:crypto'

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
}

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] ?? LOG_LEVELS.info

const ALLOWED_META_KEYS = new Set([
  'requestId', 'scene', 'provider', 'model', 'attempts', 'latencyMs', 'outcome', 'result',
  // 错误与业务标识等非敏感键；phone、token 等敏感信息仍然禁止进入日志
  'error', 'code', 'reason', 'userId', 'conversationId', 'level', 'crisisLevel', 'stack', 'action', 'host', 'strategyChars',
])

const MAX_META_VALUE_LENGTH = 200
// 入站 X-Request-Id 安全形态：仅接受 ≤64 位的字母/数字/连字符，
// 其余（注入字符、超长、非字符串）一律丢弃并重新生成，防止日志注入
const INBOUND_REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/

// 优先透传上游的 X-Request-Id，无头或不合规时随机兜底
function resolveRequestId(headerValue) {
  return typeof headerValue === 'string' && INBOUND_REQUEST_ID_PATTERN.test(headerValue)
    ? headerValue
    : randomUUID()
}

function sanitizeMeta(meta) {
  return Object.fromEntries(
    Object.entries(meta)
      .filter(([key, value]) => ALLOWED_META_KEYS.has(key) && value !== undefined)
      // 长字符串（如堆栈）截断，避免单行日志爆炸
      .map(([key, value]) => [
        key,
        typeof value === 'string' && value.length > MAX_META_VALUE_LENGTH
          ? `${value.slice(0, MAX_META_VALUE_LENGTH)}…`
          : value,
      ]),
  )
}

function formatMessage(level, message, meta = {}) {
  const timestamp = new Date().toISOString()
  const safeMeta = sanitizeMeta(meta)
  const metaStr = Object.keys(safeMeta).length > 0 ? ` ${JSON.stringify(safeMeta)}` : ''
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`
}

export const logger = {
  error(message, meta = {}) {
    if (currentLevel >= LOG_LEVELS.error) {
      console.error(formatMessage('error', message, meta))
    }
  },

  warn(message, meta = {}) {
    if (currentLevel >= LOG_LEVELS.warn) {
      console.warn(formatMessage('warn', message, meta))
    }
  },

  info(message, meta = {}) {
    if (currentLevel >= LOG_LEVELS.info) {
      console.log(formatMessage('info', message, meta))
    }
  },

  debug(message, meta = {}) {
    if (currentLevel >= LOG_LEVELS.debug) {
      console.log(formatMessage('debug', message, meta))
    }
  },

  // 请求日志中间件
  requestLogger() {
    return (req, res, next) => {
      const start = Date.now()
      req.requestId = resolveRequestId(req.headers['x-request-id'])
      res.setHeader('X-Request-Id', req.requestId)

      res.on('finish', () => {
        const latencyMs = Date.now() - start
        const level = res.statusCode >= 400 ? 'warn' : 'info'

        this[level]('HTTP Request', {
          requestId: req.requestId,
          latencyMs,
          result: `http_${res.statusCode}`,
        })
      })

      next()
    }
  },
}

export default logger
