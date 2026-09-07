import { Router } from 'express'
import { validateRequired, validateLength, validateEnum, validate } from '../utils/validate.js'
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

const validateConversationCreate = validate([
  { field: 'mode', validate: (v) => (v === undefined ? null : validateEnum(v, '模式', ['chat', 'work'])) },
])

router.post('/conversations', validateConversationCreate, async (req, res) => {
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

const validateMessageContent = validate([
  {
    field: 'content',
    validate: (value) => {
      const normalized = typeof value === 'string' ? value.trim() : value
      return validateRequired(normalized, '消息内容') || validateLength(normalized, '消息内容', 1, 10000)
    },
  },
])

router.post('/conversations/:id/messages', validateMessageContent, async (req, res) => {
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

const STREAM_HEARTBEAT_MS = 15000

// 事件编码：data: {"event": <类型>, ...payload}\n\n（类型在 JSON 的 event 字段中，
// 不使用 SSE event: 行），心跳为注释帧 `: ping\n\n`。
// error 事件只携带固定 code，绝不包含对话内容。
router.post('/conversations/:id/messages/stream', validateMessageContent, async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const controller = new AbortController()
  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(': ping\n\n')
  }, STREAM_HEARTBEAT_MS)
  heartbeat.unref?.()

  // Node 16+ 的 req 'close' 在请求体读完时就会触发，客户端断线要看 res 'close'。
  const handleClientClose = () => {
    if (!res.writableEnded) controller.abort()
  }
  res.on('close', handleClientClose)

  const send = (event, payload) => {
    if (!res.writableEnded && !res.destroyed) {
      res.write(`data: ${JSON.stringify({ event, ...payload })}\n\n`)
    }
  }

  try {
    for await (const item of chatService.sendMessageStream(
      req.params.id,
      req.user.userId,
      req.body.content,
      req.requestId,
      { signal: controller.signal },
    )) {
      if (controller.signal.aborted) break
      switch (item.type) {
        case 'sentence':
          send('delta', { text: item.text })
          break
        case 'replace':
          send('replace', { content: item.content })
          break
        case 'done':
          send('done', {
            status: 'ok',
            userMessage: item.userMessage,
            aiMessage: item.aiMessage,
            source: item.source,
          })
          break
        case 'blocked':
          send('blocked', {
            status: 'blocked',
            userMessage: item.userMessage,
            intervention: item.intervention,
          })
          break
        case 'error':
          send('error', { code: item.reason })
          break
        default:
          break
      }
    }
  } catch (error) {
    logger.error('流式发送消息失败', {
      errorCode: error.code || error.name,
      conversationId: req.params.id,
    })
    if (!controller.signal.aborted) {
      send('error', { code: error.code || 'STREAM_FAILED' })
    }
  } finally {
    clearInterval(heartbeat)
    res.off('close', handleClientClose)
    if (!res.writableEnded && !res.destroyed) res.end()
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
