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
  'error', 'code', 'reason', 'userId', 'conversationId', 'level', 'crisisLevel', 'stack',
])

const MAX_META_VALUE_LENGTH = 200

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
      req.requestId = randomUUID()
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
