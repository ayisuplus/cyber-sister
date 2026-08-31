import { Router } from 'express'
import { validateRequired, validateLength, validate } from '../utils/validate.js'
import * as chatService from '../services/chatService.js'
import logger from '../utils/logger.js'

const router = Router()

router.get('/conversations', async (req, res) => {
  try {
    const conversations = await chatService.listConversations(req.user.userId, {
      page: Number.parseInt(req.query.page, 10),
      limit: Number.parseInt(req.query.limit, 10),
    })
    res.json(conversations)
  } catch (error) {
    logger.error('获取会话列表失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取会话列表失败' })
  }
})

router.post('/conversations', async (req, res) => {
  try {
    const conversation = await chatService.createConversation(req.user.userId, req.body)
    res.json(conversation)
  } catch (error) {
    logger.error('新建会话失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '新建会话失败' })
  }
})

router.get('/conversations/:id', async (req, res) => {
  try {
    const conversation = await chatService.getConversation(req.params.id, req.user.userId, {
      page: Number.parseInt(req.query.page, 10),
      limit: Number.parseInt(req.query.limit, 10),
    })
    res.json(conversation)
  } catch (error) {
    logger.error('获取会话详情失败', { error: error.message, conversationId: req.params.id })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取会话详情失败' })
  }
})

router.post('/conversations/:id/messages', validate([
  {
    field: 'content',
    validate: (value) => {
      const normalized = typeof value === 'string' ? value.trim() : value
      return validateRequired(normalized, '消息内容') || validateLength(normalized, '消息内容', 1, 10000)
    },
  },
]), async (req, res) => {
  try {
    const result = await chatService.sendMessage(
      req.params.id,
      req.user.userId,
      req.body.content,
      req.requestId,
    )
    res.json(result)
  } catch (error) {
    logger.error('发送消息失败', {
      errorCode: error.code || error.name,
      conversationId: req.params.id,
    })
    const statusCode = error.statusCode || 500
    const body = {
      error: error.statusCode ? error.message : '发送消息失败',
      ...(error.statusCode && error.code ? { code: error.code } : {}),
    }
    res.status(statusCode).json(body)
  }
})

router.delete('/conversations/:id', async (req, res) => {
  try {
    await chatService.deleteConversation(req.params.id, req.user.userId)
    res.json({ success: true })
  } catch (error) {
    logger.error('删除会话失败', { error: error.message, conversationId: req.params.id })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '删除会话失败' })
  }
})

export default router
