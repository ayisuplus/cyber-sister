import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
import { Prisma } from '@prisma/client'

import authRoutes from './routes/auth.js'
import chatRoutes from './routes/chat.js'
import userRoutes from './routes/user.js'
import toolsRoutes from './routes/tools.js'
import memoriesRoutes from './routes/memories.js'
import complianceRoutes from './routes/compliance.js'
import { authMiddleware } from './middleware/auth.js'
import { getLLMStatus } from './services/llmService.js'
import logger from './utils/logger.js'
import prisma from './prisma/client.js'
import usageTracker from './utils/usageTracker.js'
import { closeRedis } from './utils/redis.js'

// 加载环境变量
dotenv.config()

// ============ 环境变量校验 ============
const REQUIRED_ENV_VARS = ['JWT_SECRET', 'JWT_REFRESH_SECRET']
const PLACEHOLDER_PATTERNS = ['change-in-production', 'your-super-secret', 'change-me']

for (const varName of REQUIRED_ENV_VARS) {
  const value = process.env[varName]
  if (!value) {
    logger.error(`缺少必需环境变量: ${varName}`)
    process.exit(1)
  }
  if (PLACEHOLDER_PATTERNS.some(p => value.toLowerCase().includes(p))) {
    logger.warn(`⚠️ 环境变量 ${varName} 使用了占位符值，生产环境必须修改！`)
  }
}

const isProduction = process.env.NODE_ENV === 'production'
if (isProduction && process.env.MOCK_VERIFICATION_CODE) {
  logger.warn('⚠️ 生产环境设置了 MOCK_VERIFICATION_CODE，验证码登录仍使用 Mock')
}

// ============ 应用初始化 ============
const app = express()
const PORT = process.env.PORT || 3000

// ============ 安全中间件 ============
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Vite dev 需要
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", process.env.CORS_ORIGIN || 'http://localhost:5173'].filter(Boolean),
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // 允许加载外部资源
}))

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}))

app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())  // 解析 httpOnly cookie（refresh token）

// ============ 请求日志 ============
app.use(logger.requestLogger())

// ============ 限流 ============
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' },
})
app.use('/api', limiter)

// ============ 路由挂载 ============
app.use('/api/auth', authRoutes)
app.use('/api/chat', authMiddleware, chatRoutes)
app.use('/api/user', authMiddleware, userRoutes)
app.use('/api/tools', authMiddleware, toolsRoutes)
app.use('/api/memories', authMiddleware, memoriesRoutes)
app.use('/api/compliance', authMiddleware, complianceRoutes)

// ============ 健康检查 ============
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    llm: getLLMStatus(),
  })
})

// ============ 404 处理 ============
app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' })
})

// ============ Prisma 错误分类中间件 ============
app.use((err, req, res, _next) => {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        return res.status(409).json({ error: '数据已存在' })
      case 'P2025':
        return res.status(404).json({ error: '记录不存在' })
      case 'P2003':
        return res.status(400).json({ error: '关联数据不存在' })
      default:
        logger.error('Prisma 数据库错误', {
          code: err.code,
          message: err.message,
          url: req.url,
        })
        return res.status(500).json({ error: '数据库操作失败' })
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    logger.error('Prisma 查询验证错误', { message: err.message, url: req.url })
    return res.status(400).json({ error: '请求参数有误' })
  }

  _next(err)
})

// ============ 通用错误处理 ============
app.use((err, req, res, _next) => {
  // 如果路由中已设置 statusCode（如 HttpError），则使用它
  const statusCode = err.statusCode || 500
  const message = statusCode === 500 && isProduction
    ? '服务器内部错误'
    : err.message || '服务器内部错误'

  logger.error('未处理的错误', {
    error: err.message,
    stack: isProduction ? undefined : err.stack,
    url: req.url,
    method: req.method,
    userId: req.user?.userId,
  })

  res.status(statusCode).json({ error: message })
})

// ============ 服务器启动 ============
// 测试环境下不启动服务器（supertest 直接使用 app 实例）
const isTestEnv = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'

let server = null
if (!isTestEnv) {
  server = app.listen(PORT, () => {
    logger.info(`🚀 赛博姐妹 API 服务运行在 http://localhost:${PORT}`)
    logger.info(`📝 环境: ${process.env.NODE_ENV || 'development'}`)
  })
}

// ============ Graceful Shutdown ============
let isShuttingDown = false

async function gracefulShutdown(signal) {
  if (isShuttingDown) return
  isShuttingDown = true

  logger.info(`收到 ${signal} 信号，开始优雅关闭...`)

  // 停止接受新请求
  if (server) {
    server.close(async () => {
      logger.info('HTTP 服务器已关闭')

      try {
        await prisma.$disconnect()
        logger.info('数据库连接已关闭')
      } catch (err) {
        logger.error('关闭数据库连接失败', { error: err.message })
      }

      try {
        usageTracker.destroy()
      } catch (err) {
        logger.error('关闭使用计时器失败', { error: err.message })
      }

      try {
        await closeRedis()
      } catch (err) {
        logger.error('关闭 Redis 连接失败', { error: err.message })
      }

      process.exit(0)
    })
  } else {
    // 测试环境无 server，直接清理
    await prisma.$disconnect()
    usageTracker.destroy()
    await closeRedis()
    process.exit(0)
  }

  // 30 秒超时强制退出
  setTimeout(() => {
    logger.error('优雅关闭超时，强制退出')
    process.exit(1)
  }, 30000)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// ============ 未捕获异常处理 ============
process.on('unhandledRejection', (reason, _promise) => {
  logger.error('未处理的 Promise Rejection', {
    reason: reason?.message || String(reason),
    stack: reason?.stack?.split('\n').slice(0, 3).join('\n'),
  })
})

process.on('uncaughtException', (error) => {
  logger.error('未捕获的异常，进程即将退出', {
    error: error.message,
    stack: error.stack?.split('\n').slice(0, 5).join('\n'),
  })
  // 未知状态，安全起见退出（由进程管理器重启）
  process.exit(1)
})

export default app
