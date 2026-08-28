/**
 * 结构化日志服务
 * 使用console封装，提供统一的日志接口
 */

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
}

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] ?? LOG_LEVELS.info

function formatMessage(level, message, meta = {}) {
  const timestamp = new Date().toISOString()
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ''
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

      res.on('finish', () => {
        const duration = Date.now() - start
        const level = res.statusCode >= 400 ? 'warn' : 'info'

        this[level]('HTTP Request', {
          method: req.method,
          url: req.url,
          status: res.statusCode,
          duration: `${duration}ms`,
          userAgent: req.get('User-Agent'),
          ip: req.ip,
          userId: req.user?.userId,
        })
      })

      next()
    }
  },
}

export default logger
