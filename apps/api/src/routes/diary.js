import { Router } from 'express'
import * as diaryService from '../services/diaryService.js'
import logger from '../utils/logger.js'

const router = Router()

router.get('/', async (req, res) => {
  try {
    const entries = await diaryService.listMonth(req.user.userId, req.query.month)
    res.json(entries)
  } catch (error) {
    logger.error('获取日记列表失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取日记列表失败' })
  }
})

router.get('/:day', async (req, res) => {
  try {
    const entry = await diaryService.getEntry(req.user.userId, req.params.day)
    res.json(entry)
  } catch (error) {
    logger.error('获取日记失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取日记失败' })
  }
})

router.put('/:day', async (req, res) => {
  try {
    const entry = await diaryService.upsertEntry(req.user.userId, req.params.day, req.body)
    res.json(entry)
  } catch (error) {
    logger.error('保存日记失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '保存日记失败' })
  }
})

router.delete('/:day', async (req, res) => {
  try {
    await diaryService.deleteEntry(req.user.userId, req.params.day)
    res.json({ success: true })
  } catch (error) {
    logger.error('删除日记失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '删除日记失败' })
  }
})

router.post('/:day/comment', async (req, res) => {
  try {
    const result = await diaryService.generateComment(req.user.userId, req.params.day, req.requestId)
    res.json(result)
  } catch (error) {
    logger.error('生成日记回应失败', { errorCode: error.code || error.name })
    const statusCode = error.statusCode || 500
    const body = {
      error: error.statusCode ? error.message : '生成回应失败',
      ...(error.statusCode && error.code ? { code: error.code } : {}),
    }
    res.status(statusCode).json(body)
  }
})

export default router
