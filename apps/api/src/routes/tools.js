import { Router } from 'express'
import { validateRequired, validateDate, validate } from '../utils/validate.js'
import * as toolService from '../services/toolService.js'
import logger from '../utils/logger.js'

const router = Router()

// === 待办 ===
router.get('/todos', async (req, res) => {
  try {
    const todos = await toolService.listTodos(req.user.userId)
    res.json(todos)
  } catch (error) {
    logger.error('获取待办列表失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取待办列表失败' })
  }
})

router.post('/todos', validate([
  { field: 'content', validate: (v) => validateRequired(v, '待办内容') },
]), async (req, res) => {
  try {
    const todo = await toolService.createTodo(req.user.userId, req.body)
    res.json(todo)
  } catch (error) {
    logger.error('创建待办失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '创建待办失败' })
  }
})

router.put('/todos/:id', async (req, res) => {
  try {
    const todo = await toolService.updateTodo(req.user.userId, req.params.id, req.body)
    res.json(todo)
  } catch (error) {
    logger.error('更新待办失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '更新待办失败' })
  }
})

router.delete('/todos/:id', async (req, res) => {
  try {
    await toolService.deleteTodo(req.user.userId, req.params.id)
    res.json({ success: true })
  } catch (error) {
    logger.error('删除待办失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '删除待办失败' })
  }
})

// === 倒数日 ===
router.get('/countdowns', async (req, res) => {
  try {
    const data = await toolService.listCountdowns(req.user.userId)
    res.json(data)
  } catch (error) {
    logger.error('获取倒数日列表失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取倒数日列表失败' })
  }
})

router.post('/countdowns', validate([
  { field: 'title', validate: (v) => validateRequired(v, '标题') },
  { field: 'targetDate', validate: (v) => validateRequired(v, '目标日期') || validateDate(v, '目标日期') },
]), async (req, res) => {
  try {
    const countdown = await toolService.createCountdown(req.user.userId, req.body)
    res.json(countdown)
  } catch (error) {
    logger.error('创建倒数日失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '创建倒数日失败' })
  }
})

router.delete('/countdowns/:id', async (req, res) => {
  try {
    await toolService.deleteCountdown(req.user.userId, req.params.id)
    res.json({ success: true })
  } catch (error) {
    logger.error('删除倒数日失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '删除倒数日失败' })
  }
})

// === 大姨妈 ===
router.get('/period', async (req, res) => {
  try {
    const records = await toolService.listPeriodRecords(req.user.userId)
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
    const record = await toolService.createPeriodRecord(req.user.userId, req.body)
    res.json(record)
  } catch (error) {
    logger.error('创建经期记录失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '创建经期记录失败' })
  }
})

// === 提醒 ===
router.get('/reminders', async (req, res) => {
  try {
    const reminders = await toolService.listReminders(req.user.userId)
    res.json(reminders)
  } catch (error) {
    logger.error('获取提醒列表失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取提醒列表失败' })
  }
})

router.put('/reminders/:id', async (req, res) => {
  try {
    const reminder = await toolService.updateReminder(req.user.userId, req.params.id, req.body)
    res.json(reminder)
  } catch (error) {
    logger.error('更新提醒失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '更新提醒失败' })
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
