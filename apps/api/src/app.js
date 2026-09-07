import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import { Prisma } from '@prisma/client'

import authRoutes from './routes/auth.js'
import chatRoutes from './routes/chat.js'
import userRoutes from './routes/user.js'
import toolsRoutes from './routes/tools.js'
import diaryRoutes from './routes/diary.js'
import habitsRoutes from './routes/habits.js'
import readingRoutes from './routes/reading.js'
import studyRoutes from './routes/study.js'
import memoriesRoutes from './routes/memories.js'
import complianceRoutes from './routes/compliance.js'
import virtualStudioRoutes from './routes/virtualStudio.js'
import llmRoutes from './routes/llm.js'
import workRoutes from './routes/work.js'
import localLlmAdminRoutes from './routes/localLlmAdmin.js'
import asrRoutes from './routes/asr.js'
import { authMiddleware } from './middleware/auth.js'
import { instanceAdminMiddleware } from './middleware/instanceAdmin.js'
import logger from './utils/logger.js'
import prisma from './prisma/client.js'
import usageTracker from './utils/usageTracker.js'
import { closeBrowser } from './services/browserService.js'
import { initWorkExtensions } from './services/workExtensionService.js'
import { closeMcpClients } from './services/mcpService.js'
import { validateRuntimeConfig } from './config/runtime.js'

const APP_ENV = process.env.APP_ENV || 'development'
const NODE_ENV = process.env.NODE_ENV || 'development'
const IS_PROTECTED_ENV = APP_ENV === 'internal' || NODE_ENV === 'production'
const PORT = process.env.PORT || 3000
const VERSION = '1.0.0'
async function checkDatabaseReady(timeoutMs = 2000) {
  let timeout
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('database readiness timeout')), timeoutMs)
      }),
    ])
    return true
  } finally {
    clearTimeout(timeout)
  }
}

validateRuntimeConfig()

const app = express()
app.set('trust proxy', 1)
app.use(logger.requestLogger())

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", process.env.CORS_ORIGIN || 'http://localhost:5173'].filter(Boolean),
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}))

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}))
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

app.get('/api/health/live', (_req, res) => {
  res.json({ status: 'ok', version: VERSION, environment: APP_ENV })
})

app.get('/api/health/ready', async (req, res) => {
  let database = false
  try {
    database = await checkDatabaseReady()
  } catch {
    logger.warn('数据库就绪检查失败', {
      requestId: req.requestId,
      result: 'database_unavailable',
    })
  }

  const ready = database
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    checks: {
      database: database ? 'ok' : 'unavailable',
    },
  })
})

// 暂时保留旧探针作为纯进程存活检查；编排系统应改用 live/ready。
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: VERSION, environment: APP_ENV })
})

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' },
})

// Makeup 通过内部服务转发时所有请求共享容器 IP；模型能力在鉴权后按用户限流，
// 避免一个测试者耗尽其他测试者的配额。
const llmUserLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user.userId}`,
  message: { error: '模型请求过于频繁，请稍后再试' },
})

app.use('/api/llm', authMiddleware, llmUserLimiter, llmRoutes)
app.use('/api', limiter)

app.use('/api/auth', authRoutes)
app.use('/api/chat', authMiddleware, chatRoutes)
app.use('/api/user', authMiddleware, userRoutes)
app.use('/api/admin/llm/local', authMiddleware, instanceAdminMiddleware, localLlmAdminRoutes)
if (APP_ENV === 'internal') {
  // 经期/倒数日/待办/提醒在内测开放；天气路由是硬编码假数据，保持关闭。
  app.use('/api/tools/weather', authMiddleware, (_req, res) => {
    res.status(409).json({ error: '该功能未在内测中开放', code: 'FEATURE_NOT_AVAILABLE' })
  })
}
app.use('/api/tools', authMiddleware, toolsRoutes)
app.use('/api/diary', authMiddleware, diaryRoutes)
app.use('/api/habits', authMiddleware, habitsRoutes)
app.use('/api/memories', authMiddleware, memoriesRoutes)
app.use('/api/virtual', authMiddleware, virtualStudioRoutes)
app.use('/api/reading', authMiddleware, readingRoutes)
app.use('/api/study', authMiddleware, studyRoutes)
app.use('/api/compliance', authMiddleware, complianceRoutes)
app.use('/api/work', authMiddleware, workRoutes)
app.use('/api/asr', authMiddleware, asrRoutes)

app.use((_req, res) => {
  res.status(404).json({ error: '接口不存在' })
})

app.use((err, req, res, next) => {
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
          requestId: req.requestId,
          result: `prisma_${err.code}`,
        })
        return res.status(500).json({ error: '数据库操作失败' })
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    logger.error('Prisma 查询验证错误', {
      requestId: req.requestId,
      result: 'prisma_validation_error',
    })
    return res.status(400).json({ error: '请求参数有误' })
  }

  next(err)
})

app.use((err, req, res, _next) => {
  const statusCode = err.statusCode || 500
  const message = statusCode === 500 && IS_PROTECTED_ENV
    ? '服务器内部错误'
    : err.message || '服务器内部错误'

  logger.error('未处理的错误', {
    requestId: req.requestId,
    result: `http_${statusCode}`,
  })
  res.status(statusCode).json({ error: message, ...(err.code ? { code: err.code } : {}) })
})

const isTestEnv = NODE_ENV === 'test' || process.env.VITEST === 'true'
let server = null
if (!isTestEnv) {
  // 内测环境 BIND_ADDRESS 已经 validateRuntimeConfig 强制校验为具体私网 IPv4；
  // 开发环境未设置时保持 Node 默认绑定行为。
  const bindAddress = process.env.BIND_ADDRESS
  server = bindAddress
    ? app.listen(Number(PORT), bindAddress, () => {
        logger.info(`赛博姐妹 API 服务运行在 ${bindAddress}:${PORT}`, { environment: APP_ENV })
      })
    : app.listen(PORT, () => {
        logger.info(`赛博姐妹 API 服务运行在端口 ${PORT}`, { environment: APP_ENV })
      })
  // 工作模式扩展（技能/插件/MCP）异步初始化，不阻塞 listen；
  // MCP 连接就绪前模型看不到扩展工具，如实无能力。
  initWorkExtensions().catch((error) => logger.error('工作模式扩展初始化失败', { error: error.message }))
}

let isShuttingDown = false
async function gracefulShutdown(signal) {
  if (isShuttingDown) return
  isShuttingDown = true
  logger.info(`收到 ${signal} 信号，开始优雅关闭`)
  const closeDependencies = async () => {
    try {
      await closeBrowser()
      await closeMcpClients()
      await prisma.$disconnect()
      usageTracker.destroy()
    } catch (error) {
      logger.error('关闭依赖失败', { error: error.message })
    }
  }

  if (server) {
    server.close(async () => {
      await closeDependencies()
      process.exit(0)
    })
  } else {
    await closeDependencies()
  }

  setTimeout(() => {
    logger.error('优雅关闭超时，强制退出')
    process.exit(1)
  }, 30000).unref()
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('unhandledRejection', (reason) => {
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
  process.exit(1)
})

export default app
