import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import * as reminderService from '../services/reminderService.js'
import { executeScheduledTask } from '../services/chatService.js'
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

// 到点投递：前端前台轮询。任务型提醒在此惰性执行（agent 回路），产出写入投递后再返回
router.get('/due', async (req, res) => {
  try {
    const deliveries = await reminderService.listDueReminders(req.user.userId)
    const executable = deliveries.filter((d) => d.reminder?.instruction && d.result == null)
    if (executable.length > 0) {
      await Promise.all(executable.map(async (delivery) => {
        const requestId = randomUUID()
        try {
          const outcome = await executeScheduledTask(req.user.userId, delivery.reminder.instruction, requestId)
          await reminderService.completeTaskDelivery(delivery.id, req.user.userId, outcome.content)
          delivery.result = outcome.content
        } catch (error) {
          logger.warn('定时任务执行失败', { requestId, deliveryId: delivery.id, error: error.message })
          await reminderService.failTaskDelivery(delivery.id, req.user.userId)
          delivery.status = 'failed'
        }
      }))
    }
    // 执行失败的任务不进铃铛
    res.json({ deliveries: deliveries.filter((d) => d.status === 'pending') })
  } catch (error) {
    logger.error('拉取到期提醒失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '拉取到期提醒失败' })
  }
})

// 确认投递（知道了 / 忽略）
router.post('/deliveries/:id/ack', async (req, res) => {
  try {
    const delivery = await reminderService.ackDelivery(req.params.id, req.user.userId, req.body?.action)
    res.json({ delivery })
  } catch (error) {
    logger.error('确认提醒投递失败', { error: error.message, userId: req.user.userId, deliveryId: req.params.id })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '确认提醒投递失败' })
  }
})

export default router
