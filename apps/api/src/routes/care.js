import { Router } from 'express'
import * as careService from '../services/careService.js'
import logger from '../utils/logger.js'

const router = Router()

router.get('/touchpoints', async (req, res) => {
  try {
    const touchpoints = await careService.listTouchpoints(req.user.userId)
    res.json({ touchpoints })
  } catch (error) {
    logger.error('获取关怀触点失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取关怀触点失败' })
  }
})

router.post('/touchpoints/dismiss', async (req, res) => {
  try {
    const result = await careService.dismissTouchpoint(req.user.userId, req.body?.key)
    res.json(result)
  } catch (error) {
    logger.error('忽略关怀触点失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '忽略关怀触点失败' })
  }
})

export default router
