import { Router } from 'express'
import * as reminderService from '../services/reminderService.js'
import { SLEEP_KINDS, sleepLineFor, sourceOf } from '../services/sleepLines.js'
import logger from '../utils/logger.js'

const router = Router()

// 自定义定时提醒 CRUD
router.get('/scheduled', async (req, res) => {
  try {
    const reminders = await reminderService.listScheduledReminders(req.user.userId)
    res.json({ reminders })
  } catch (error) {
    logger.error('获取提醒列表失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取提醒列表失败' })
  }
})

router.post('/scheduled', async (req, res) => {
  try {
    const reminder = await reminderService.createScheduledReminder(req.user.userId, req.body ?? {})
    res.status(201).json({ reminder })
  } catch (error) {
    logger.error('创建提醒失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '创建提醒失败' })
  }
})

router.put('/scheduled/:id', async (req, res) => {
  try {
    const reminder = await reminderService.updateScheduledReminder(req.params.id, req.user.userId, req.body ?? {})
    res.json({ reminder })
  } catch (error) {
    logger.error('更新提醒失败', { error: error.message, userId: req.user.userId, reminderId: req.params.id })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '更新提醒失败' })
  }
})

router.delete('/scheduled/:id', async (req, res) => {
  try {
    await reminderService.deleteScheduledReminder(req.params.id, req.user.userId)
    res.json({ ok: true })
  } catch (error) {
    logger.error('删除提醒失败', { error: error.message, userId: req.user.userId, reminderId: req.params.id })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '删除提醒失败' })
  }
})

// 睡眠卡（路线图 C28）：晚安提醒与早安闹钟。GET 顺带把到点的建成投递（与对话页便签同一个「读的时候生成」），
// due 里每条带上那句话；「起来了」「知道了」走对话页便签同一个确认：POST /api/chat/nudges/:id/ack
function sleepNote(delivery, userId, wake) {
  const line = sleepLineFor(delivery, userId, wake)
  return {
    id: `reminder:${delivery.id}`,
    kind: delivery.reminder.kind,
    fireAt: delivery.fireAt,
    line: line ? { text: line.text, source: sourceOf(line) } : null,
  }
}

router.get('/sleep', async (req, res) => {
  const { userId } = req.user
  try {
    const due = await reminderService.listDueReminders(userId, new Date(), { kinds: SLEEP_KINDS })
    const routine = await reminderService.getSleepRoutine(userId)
    res.json({ ...routine, due: due.map((delivery) => sleepNote(delivery, userId, routine.wake)) })
  } catch (error) {
    logger.error('获取睡眠卡失败', { error: error.message, userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取睡眠卡失败' })
  }
})

router.put('/sleep', async (req, res) => {
  try {
    const routine = await reminderService.saveSleepRoutine(req.user.userId, req.body ?? {})
    res.json(routine)
  } catch (error) {
    logger.error('保存睡眠卡失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '保存睡眠卡失败' })
  }
})

export default router
