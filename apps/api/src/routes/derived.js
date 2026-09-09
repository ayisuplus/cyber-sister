import { Router } from 'express'
import * as derivedService from '../services/derivedService.js'
import * as edgeService from '../services/edgeService.js'
import logger from '../utils/logger.js'

const router = Router()

router.get('/', async (req, res) => {
  try {
    const insights = await derivedService.listInsights(req.user.userId, { status: req.query.status })
    res.json({ insights })
  } catch (error) {
    logger.error('获取工作台列表失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取工作台列表失败' })
  }
})

router.post('/analyze', async (req, res) => {
  try {
    const result = await derivedService.analyzeNow(req.user.userId, req.requestId)
    res.json(result)
  } catch (error) {
    logger.error('工作台分析失败', { errorCode: error.code || error.name })
    const statusCode = error.statusCode || 500
    const body = {
      error: error.statusCode ? error.message : '工作台分析失败',
      ...(error.statusCode && error.code ? { code: error.code } : {}),
    }
    res.status(statusCode).json(body)
  }
})

router.post('/rebuild', async (req, res) => {
  try {
    const result = await derivedService.rebuildInsights(req.user.userId, req.requestId)
    res.json(result)
  } catch (error) {
    logger.error('重建工作台失败', { errorCode: error.code || error.name })
    const statusCode = error.statusCode || 500
    const body = {
      error: error.statusCode ? error.message : '重建工作台失败',
      ...(error.statusCode && error.code ? { code: error.code } : {}),
    }
    res.status(statusCode).json(body)
  }
})

// 记忆关系边（M2）：派生边由工作台分析抽取，确认后晋升 canonical 参与聊天一跳联想
router.get('/edges', async (req, res) => {
  try {
    const edges = await edgeService.listEdges(req.user.userId, { status: req.query.status })
    res.json({ edges })
  } catch (error) {
    logger.error('获取记忆关系列表失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取记忆关系列表失败' })
  }
})

router.post('/edges/:id/promote', async (req, res) => {
  try {
    const edge = await edgeService.promoteEdge(req.user.userId, req.params.id)
    res.json({ edge })
  } catch (error) {
    logger.error('记忆关系确认失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '记忆关系确认失败' })
  }
})

router.post('/edges/:id/dismiss', async (req, res) => {
  try {
    await edgeService.dismissEdge(req.user.userId, req.params.id)
    res.json({ success: true })
  } catch (error) {
    logger.error('记忆关系忽略失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '记忆关系忽略失败' })
  }
})

router.post('/:id/promote', async (req, res) => {
  try {
    const result = await derivedService.promoteInsight(req.user.userId, req.params.id, req.body ?? {})
    res.json(result)
  } catch (error) {
    logger.error('工作台条目晋升失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '工作台条目晋升失败' })
  }
})

router.post('/:id/resolve', async (req, res) => {
  try {
    const result = await derivedService.resolveInsight(req.user.userId, req.params.id, req.body ?? {})
    res.json(result)
  } catch (error) {
    logger.error('工作台条目厘清失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '工作台条目厘清失败' })
  }
})

router.post('/:id/dismiss', async (req, res) => {
  try {
    await derivedService.dismissInsight(req.user.userId, req.params.id)
    res.json({ success: true })
  } catch (error) {
    logger.error('工作台条目忽略失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '工作台条目忽略失败' })
  }
})

router.delete('/', async (req, res) => {
  try {
    const cleared = await derivedService.clearInsights(req.user.userId)
    res.json({ cleared })
  } catch (error) {
    logger.error('清空工作台失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '清空工作台失败' })
  }
})

export default router
