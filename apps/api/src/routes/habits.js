import { Router } from 'express'
import * as habitService from '../services/habitService.js'
import logger from '../utils/logger.js'

const router = Router()

router.get('/', async (req, res) => {
  try {
    const habits = await habitService.listHabitsWithStatus(req.user.userId)
    res.json(habits)
  } catch (error) {
    logger.error('获取习惯列表失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取习惯列表失败' })
  }
})

router.post('/', async (req, res) => {
  try {
    const habit = await habitService.createHabit(req.user.userId, req.body)
    res.json(habit)
  } catch (error) {
    logger.error('创建习惯失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '创建习惯失败' })
  }
})

router.patch('/:id', async (req, res) => {
  try {
    const habit = await habitService.updateHabit(req.user.userId, req.params.id, req.body)
    res.json(habit)
  } catch (error) {
    logger.error('更新习惯失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '更新习惯失败' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await habitService.archiveHabit(req.user.userId, req.params.id)
    res.json({ success: true })
  } catch (error) {
    logger.error('归档习惯失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '归档习惯失败' })
  }
})

router.post('/:id/checkin', async (req, res) => {
  try {
    const result = await habitService.toggleCheckin(req.user.userId, req.params.id, req.body?.day)
    res.json(result)
  } catch (error) {
    logger.error('切换打卡失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '切换打卡失败' })
  }
})

router.post('/cheer', async (req, res) => {
  try {
    const result = await habitService.generateCheer(req.user.userId, req.requestId)
    res.json(result)
  } catch (error) {
    logger.error('生成手帐鼓励失败', { errorCode: error.code || error.name })
    const statusCode = error.statusCode || 500
    const body = {
      error: error.statusCode ? error.message : '生成鼓励失败',
      ...(error.statusCode && error.code ? { code: error.code } : {}),
    }
    res.status(statusCode).json(body)
  }
})

export default router
