import { Router } from 'express'
import { validateRequired, validateDate, validate } from '../utils/validate.js'
import * as periodService from '../services/periodService.js'
import logger from '../utils/logger.js'

// /api/tools 现只承载经期记录；日程、倒数日与提醒已由「安排」（/api/reminders/scheduled）替代。
const router = Router()

// === 大姨妈 ===
router.get('/period/summary', async (req, res, next) => {
  try { res.json(await periodService.getPeriodSummary(req.user.userId, req.query.today)) } catch (error) { next(error) }
})

router.put('/period/:id', async (req, res, next) => {
  try { res.json(await periodService.updatePeriodRecord(req.user.userId, req.params.id, req.body)) } catch (error) { next(error) }
})

router.delete('/period/:id', async (req, res, next) => {
  try {
    await periodService.deletePeriodRecord(req.user.userId, req.params.id)
    res.json({ success: true })
  } catch (error) { next(error) }
})

router.get('/period', async (req, res) => {
  try {
    const records = await periodService.listPeriodRecords(req.user.userId)
    res.json(records)
  } catch (error) {
    logger.error('获取经期记录失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取经期记录失败' })
  }
})

router.post('/period', validate([
  { field: 'startDate', validate: (v) => validateRequired(v, '开始日期') || validateDate(v, '开始日期') },
]), async (req, res) => {
  try {
    const record = await periodService.createPeriodRecord(req.user.userId, req.body)
    res.json(record)
  } catch (error) {
    logger.error('创建经期记录失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '创建经期记录失败' })
  }
})

// === 天气 (Mock) ===
router.get('/weather', (req, res) => {
  res.json({
    city: '上海',
    temp: 32,
    condition: '多云',
    humidity: 65,
    tip: '明天降温，记得穿外套',
  })
})

export default router
