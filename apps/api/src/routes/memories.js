import { Router } from 'express'
import * as memoryService from '../services/memoryService.js'
import logger from '../utils/logger.js'

const router = Router()

function sendError(res, error, fallback) {
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : fallback,
    ...(error.code ? { code: error.code } : {}),
  })
}

router.post('/', async (req, res) => {
  try {
    const memory = await memoryService.createMemory(req.user.userId, req.body)
    res.status(201).json(memory)
  } catch (error) {
    logger.error('创建记忆失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '创建记忆失败')
  }
})

router.get('/', async (req, res) => {
  try {
    const { type, page, limit } = req.query
    const result = await memoryService.listMemories(req.user.userId, {
      type,
      page: Number.parseInt(page, 10),
      limit: Number.parseInt(limit, 10),
    })
    res.json(result)
  } catch (error) {
    logger.error('获取记忆列表失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '获取记忆列表失败')
  }
})

router.put('/:id', async (req, res) => {
  try {
    const memory = await memoryService.updateMemory(req.user.userId, req.params.id, req.body)
    res.json(memory)
  } catch (error) {
    logger.error('编辑记忆失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '编辑记忆失败')
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await memoryService.deleteMemory(req.user.userId, req.params.id)
    res.json({ success: true })
  } catch (error) {
    logger.error('删除记忆失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '删除记忆失败')
  }
})

router.delete('/', async (req, res) => {
  try {
    const deleted = await memoryService.clearAllMemories(req.user.userId)
    res.json({ success: true, deleted })
  } catch (error) {
    logger.error('清空记忆失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '清空记忆失败')
  }
})

export default router
