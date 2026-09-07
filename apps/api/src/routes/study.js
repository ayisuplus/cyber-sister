import { Router } from 'express'
import * as studyService from '../services/studyService.js'
import logger from '../utils/logger.js'

const router = Router()

router.get('/sessions', async (req, res) => {
  try {
    const days = req.query.days === undefined ? 30 : Number(req.query.days)
    const sessions = await studyService.listSessions(req.user.userId, days)
    res.json(sessions)
  } catch (error) {
    logger.error('获取自习记录失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取自习记录失败' })
  }
})

router.post('/sessions', async (req, res) => {
  try {
    const session = await studyService.recordSession(req.user.userId, req.body)
    res.json(session)
  } catch (error) {
    logger.error('记录自习失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '记录自习失败' })
  }
})

router.get('/summary', async (req, res) => {
  try {
    const summary = await studyService.getSummary(req.user.userId)
    res.json(summary)
  } catch (error) {
    logger.error('获取自习统计失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取自习统计失败' })
  }
})

router.post('/sessions/:id/comment', async (req, res) => {
  try {
    const result = await studyService.generateSessionComment(req.user.userId, req.params.id, req.requestId)
    res.json(result)
  } catch (error) {
    logger.error('生成自习回应失败', { errorCode: error.code || error.name })
    const statusCode = error.statusCode || 500
    const body = {
      error: error.statusCode ? error.message : '生成回应失败',
      ...(error.statusCode && error.code ? { code: error.code } : {}),
    }
    res.status(statusCode).json(body)
  }
})

export default router
