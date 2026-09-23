import { Router } from 'express'
import { authMiddleware } from '../middleware/auth.js'
import * as bridgeService from '../services/bridgeService.js'
import { completeJob, waitForJob } from '../services/bridgeBroker.js'
import logger from '../utils/logger.js'

// 本机助手：设置页用登录身份管理电脑；助手用连接码换令牌，再用令牌长轮询取任务、交回结果。
const router = Router()

const sendError = (res, error, fallback) => res.status(error.statusCode || 500).json({
  error: error.statusCode ? error.message : fallback,
  ...(error.statusCode && error.code ? { code: error.code } : {}),
})

async function bridgeAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bridge ') ? header.slice('Bridge '.length).trim() : ''
  try {
    const bridge = await bridgeService.authenticateBridge(token)
    if (!bridge) return res.status(401).json({ error: '这台电脑的连接已失效，请重新配对', code: 'BRIDGE_UNAUTHORIZED' })
    req.bridge = bridge
    return next()
  } catch (error) {
    logger.error('本机助手身份校验失败', { error: error.message })
    return res.status(500).json({ error: '本机助手身份校验失败' })
  }
}

// ---- 设置页（登录用户） ----
router.post('/pairings', authMiddleware, async (req, res) => {
  try { res.json(await bridgeService.createPairing(req.user.userId)) } catch (error) { sendError(res, error, '生成连接码失败') }
})

router.get('/', authMiddleware, async (req, res) => {
  try { res.json({ bridges: await bridgeService.listBridges(req.user.userId) }) } catch (error) { sendError(res, error, '读取已连接的电脑失败') }
})

router.delete('/:id', authMiddleware, async (req, res) => {
  try { res.json(await bridgeService.revokeBridge(req.user.userId, req.params.id)) } catch (error) { sendError(res, error, '断开失败') }
})

// ---- 助手（连接码 / 令牌） ----
router.post('/claim', async (req, res) => {
  try { res.json(await bridgeService.claimPairing(req.body)) } catch (error) { sendError(res, error, '配对失败') }
})

router.get('/poll', bridgeAuth, async (req, res) => {
  const controller = new AbortController()
  res.on('close', () => { if (!res.writableFinished) controller.abort() })
  try {
    void bridgeService.touchBridge(req.bridge).catch(() => {})
    const job = await waitForJob(req.bridge, { signal: controller.signal })
    if (controller.signal.aborted || res.writableEnded) return
    if (job) res.json({ job })
    else res.status(204).end()
  } catch (error) {
    if (!res.headersSent) sendError(res, error, '取任务失败')
  }
})

router.post('/jobs/:id/result', bridgeAuth, (req, res) => {
  const accepted = completeJob(req.bridge.id, req.params.id, req.body || {})
  if (!accepted) return res.status(404).json({ error: '任务不存在或已结束' })
  return res.json({ ok: true })
})

export default router
