import { Router } from 'express'
import * as memoryService from '../services/memoryService.js'
import logger from '../utils/logger.js'

const router = Router()

router.get('/', async (req, res) => {
  try {
    const { type, search, page, limit } = req.query
    const result = await memoryService.listMemories(req.user.userId, {
      type,
      search,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
    })
    res.json(result)
  } catch (error) {
    logger.error('获取记忆列表失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取记忆列表失败' })
  }
})

router.put('/:id', async (req, res) => {
  try {
    const memory = await memoryService.updateMemory(req.user.userId, req.params.id, req.body)
    res.json(memory)
  } catch (error) {
    logger.error('编辑记忆失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '编辑记忆失败' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await memoryService.deleteMemory(req.user.userId, req.params.id)
    res.json({ success: true })
  } catch (error) {
    logger.error('删除记忆失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '删除记忆失败' })
  }
})

router.delete('/', async (req, res) => {
  try {
    await memoryService.clearAllMemories(req.user.userId)
    res.json({ success: true })
  } catch (error) {
    logger.error('清空记忆失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '清空记忆失败' })
  }
})

export default router
