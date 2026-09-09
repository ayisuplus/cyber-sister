import { Router } from 'express'
import * as letterService from '../services/letterService.js'
import logger from '../utils/logger.js'

const router = Router()

router.get('/', async (req, res) => {
  try {
    const letters = await letterService.listLetters(req.user.userId)
    res.json({ letters })
  } catch (error) {
    logger.error('获取来信列表失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取来信列表失败' })
  }
})

router.post('/generate', async (req, res) => {
  try {
    const result = await letterService.generateWeeklyLetter(req.user.userId)
    res.json(result)
  } catch (error) {
    logger.error('生成来信失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '生成来信失败' })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const letter = await letterService.getLetter(req.user.userId, req.params.id)
    res.json({ letter })
  } catch (error) {
    logger.error('读取来信失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '读取来信失败' })
  }
})

export default router
