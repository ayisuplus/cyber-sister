import { Router } from 'express'
import prisma from '../prisma/client.js'
import logger from '../utils/logger.js'
import usageTracker from '../utils/usageTracker.js'

const router = Router()
const CRISIS_LEVELS = new Set(['high', 'medium'])
// 与 chatService.persistBlockedCrisis 的隐私口径对齐：触发消息最少化留存
const MAX_TRIGGER_MSG_LENGTH = 500

// 内测危机记录只能由聊天事务创建，禁止客户端绕过该事务直接写入。
if (process.env.APP_ENV !== 'internal') {
  router.post('/crisis', async (req, res) => {
    try {
      const { triggerMsg, level } = req.body
      const userId = req.user.userId

      if (!CRISIS_LEVELS.has(level)) {
        return res.status(400).json({ error: '危机等级必须是 high 或 medium' })
      }

      const log = await prisma.crisisLog.create({
        data: {
          userId,
          triggerMsg: typeof triggerMsg === 'string' && triggerMsg.trim()
            ? triggerMsg.trim().slice(0, MAX_TRIGGER_MSG_LENGTH)
            : null,
          level,
          handled: false,
        },
      })

      logger.warn('危机事件上报', { userId, level, logId: log.id })
      res.json({ success: true, logId: log.id })
    } catch (error) {
      logger.error('危机事件上报失败', { error: error.message })
      res.status(500).json({ error: '危机事件上报失败' })
    }
  })
}

// 开始使用计时
router.post('/usage/start', (req, res) => {
  try {
    const userId = req.user.userId
    const status = usageTracker.start(userId)

    logger.debug('开始使用计时', { userId, ...status })
    res.json({
      success: true,
      startAt: new Date().toISOString(),
      ...status,
    })
  } catch (error) {
    logger.error('开始使用计时失败', { error: error.message })
    res.status(500).json({ error: '开始使用计时失败' })
  }
})

// 心跳 - 更新活动时间
router.post('/usage/heartbeat', (req, res) => {
  try {
    const userId = req.user.userId
    const status = usageTracker.heartbeat(userId)
    res.json(status || { minutes: 0, shouldRemind: false, isActive: false })
  } catch (error) {
    logger.error('心跳上报失败', { error: error.message })
    res.status(500).json({ error: '心跳上报失败' })
  }
})

// 结束使用计时
router.post('/usage/end', (req, res) => {
  try {
    const userId = req.user.userId
    const status = usageTracker.end(userId)

    logger.debug('结束使用计时', { userId, ...status })
    res.json({ success: true, ...status })
  } catch (error) {
    logger.error('结束使用计时失败', { error: error.message })
    res.status(500).json({ error: '结束使用计时失败' })
  }
})

// 获取当前使用时长
router.get('/usage/status', (req, res) => {
  try {
    const userId = req.user.userId
    const status = usageTracker.getStatus(userId)

    res.json(status)
  } catch (error) {
    logger.error('获取使用时长失败', { error: error.message })
    res.status(500).json({ error: '获取使用时长失败' })
  }
})

export default router
