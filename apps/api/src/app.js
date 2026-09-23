import { startMemoryIndexWorker, stopMemoryIndexWorker } from './services/memoryIndexService.js'
import { startWorkTaskWorker, stopWorkTaskWorker } from './services/workTaskService.js'
import { isLocalWorkRuntime, localWorkOnly } from './config/distribution.js'
import { startWorkContainerReaper, stopWorkContainerReaper } from './services/workExecutionService.js'
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
import readingRoutes from './routes/reading.js'
import memoriesRoutes from './routes/memories.js'
import complianceRoutes from './routes/compliance.js'
import llmRoutes from './routes/llm.js'
import workRoutes from './routes/work.js'
import asrRoutes from './routes/asr.js'
import collectionRoutes from './routes/collection.js'
import reminderRoutes from './routes/reminders.js'
import letterRoutes from './routes/letters.js'
import bridgeRoutes from './routes/bridge.js'
import adminModelProvidersRoutes from './routes/adminModelProviders.js'
import { hashSecret } from './services/bridgeService.js'
import { loadCloudProviders } from './services/llmService.js'
import { builtinToolNames } from './services/agentService.js'
import { initExtensions, shutdownExtensions } from './services/extensionRuntime.js'
import { authMiddleware } from './middleware/auth.js'
import { instanceAdminMiddleware } from './middleware/instanceAdmin.js'
import logger from './utils/logger.js'
import prisma from './prisma/client.js'
import usageTracker from './utils/usageTracker.js'
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
// 迁移包与前端 10MB 上限一致；其他 JSON 请求维持原上限。
app.use('/api/user/import', express.json({ limit: '10mb' }))
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
  // 进度轮询与本机助手的取任务/交结果有独立的鉴权与额度，不能耗尽聊天、保存及退出登录的普通额度
  // （助手和浏览器常在同一个家庭网络、同一个公网 IP 下）。
  skip: (req) => {
    const path = req.originalUrl.split('?')[0]
    if (req.method === 'GET' && /^\/api\/(?:memories\/index-jobs\/[^/]+|work\/tasks(?:\/[^/]+)?|bridge\/poll)$/.test(path)) return true
    return req.method === 'POST' && /^\/api\/bridge\/jobs\/[^/]+\/result$/.test(path)
  },
})
// 每台电脑自己的额度：长轮询 25 秒一轮，正常远低于此；按令牌哈希计数，不信任 IP。
const bridgeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `bridge:${hashSecret(req.headers.authorization || '')}`,
  message: { error: '本机助手请求过于频繁，请稍后再试' },
})
const memoryProgressLimiter = rateLimit({
  windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
  skip: (req) => req.method !== 'GET',
  keyGenerator: (req) => `user:${req.user.userId}`,
  message: { error: '进度查询过于频繁，请稍后刷新' },
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
app.use('/api/memories/index-jobs', authMiddleware, memoryProgressLimiter)
app.use('/api/work/tasks', authMiddleware, memoryProgressLimiter)
// 只有一个 Web 版：安排、手记、经期、装扮与「她」都走普通鉴权。
// 本机能力（文件、代码、浏览器、后台任务）只在 API 跑在用户自己的电脑上时开放。
app.use('/api/work', authMiddleware, localWorkOnly)
app.use(['/api/bridge/poll', '/api/bridge/jobs'], bridgeLimiter)
app.use('/api', limiter)

app.use('/api/auth', authRoutes)
app.use('/api/chat', authMiddleware, chatRoutes)
app.use('/api/user', authMiddleware, userRoutes)
app.use('/api/tools', authMiddleware, toolsRoutes)
app.use('/api/diary', authMiddleware, diaryRoutes)
app.use('/api/memories', authMiddleware, memoriesRoutes)
app.use('/api/reading', authMiddleware, readingRoutes)
app.use('/api/compliance', authMiddleware, complianceRoutes)
app.use('/api/work', authMiddleware, workRoutes)
app.use('/api/asr', authMiddleware, asrRoutes)
// 装扮里的收藏（衣柜 / 化妆间）；旧的化妆预设、3D 衣柜与模拟预览接口已于 2026-09-21 下线
app.use('/api/collection', authMiddleware, collectionRoutes)
app.use('/api/reminders', authMiddleware, reminderRoutes)
app.use('/api/letters', authMiddleware, letterRoutes)
// 本机助手：路由内分别用登录身份（设置页）和助手令牌（取任务/交结果）鉴权
app.use('/api/bridge', bridgeRoutes)
// 模型供应商：只有实例管理员能配。authMiddleware 在前，管理员中间件要读 req.user
app.use('/api/admin/model-providers', authMiddleware, instanceAdminMiddleware, adminModelProvidersRoutes)

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
  // 自定义模型供应商：启动时读一次库，之后每次配置变更即时重读并重建网关。
  // 读不到就让快照保持空着（请求时会再试一次），不阻塞启动。
  await loadCloudProviders().catch(() => logger.warn('模型供应商配置尚未就绪，先用环境变量槽'))
  void startMemoryIndexWorker().catch(() => logger.warn('记忆索引任务尚未就绪'))
  if (isLocalWorkRuntime()) {
    startWorkTaskWorker()
    startWorkContainerReaper()
  }
  // 仓库内扩展：装配完成后、开始监听前加载（工具注册不得覆盖内置工具）
  await initExtensions({ reservedToolNames: builtinToolNames() })
  // 内测环境 BIND_ADDRESS 已经 validateRuntimeConfig 强制校验为具体私网 IPv4；
  // 开发环境未设置时保持 Node 默认绑定行为。
  // 容器化部署里进程的监听地址与宿主机暴露地址是两件事：API 不发布宿主机端口，
  // 由 API_LISTEN_ADDRESS 指定容器内监听地址（compose 中为 0.0.0.0），未设置时沿用 BIND_ADDRESS。
  const bindAddress = process.env.API_LISTEN_ADDRESS || process.env.BIND_ADDRESS
  server = bindAddress
    ? app.listen(Number(PORT), bindAddress, () => {
        logger.info(`Amie API 服务运行在 ${bindAddress}:${PORT}`, { environment: APP_ENV })
      })
    : app.listen(PORT, () => {
        logger.info(`Amie API 服务运行在端口 ${PORT}`, { environment: APP_ENV })
      })
}

let isShuttingDown = false
async function gracefulShutdown(signal) {
  if (isShuttingDown) return
  isShuttingDown = true
  logger.info(`收到 ${signal} 信号，开始优雅关闭`)
  stopMemoryIndexWorker()
  const closeDependencies = async () => {
    try {
      await shutdownExtensions()
      await stopWorkTaskWorker()
      await stopWorkContainerReaper()
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
