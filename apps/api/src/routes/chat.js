import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { validateRequired, validateLength, validate } from '../utils/validate.js'
import { workMessageUpload } from '../utils/workMessageUpload.js'
import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import * as chatService from '../services/chatService.js'
import { runConfirmedTool } from '../services/agentService.js'
import * as nudgeService from '../services/nudgeService.js'
import * as openerService from '../services/openerService.js'
import { readChatImage } from '../services/chatImageService.js'
import logger from '../utils/logger.js'

const router = Router()

router.get('/images/:messageId', async (req, res) => {
  try {
    const message = await prisma.message.findFirst({
      where: { id: req.params.messageId, conversation: { userId: req.user.userId } },
      select: { imageExt: true },
    })
    if (!message?.imageExt) throw new HttpError('图片不存在', 404)
    const { buffer, mime } = await readChatImage(req.user.userId, req.params.messageId, message.imageExt)
    res.set('Cache-Control', 'no-store').type(mime).send(buffer)
  } catch (error) {
    logger.error('读取聊天图片失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '读取聊天图片失败' })
  }
})

router.get('/conversations', async (req, res) => {
  try {
    if (req.query.archived !== undefined && !['true', 'false'].includes(req.query.archived)) {
      return res.status(400).json({ error: 'archived 必须为 true 或 false' })
    }
    const conversations = await chatService.listConversations(req.user.userId, {
      page: Number.parseInt(req.query.page, 10),
      limit: Number.parseInt(req.query.limit, 10),
      ...(req.query.archived !== undefined ? { archived: req.query.archived === 'true' } : {}),
    })
    res.json(conversations)
  } catch (error) {
    logger.error('获取会话列表失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取会话列表失败' })
  }
})

router.patch('/conversations/:id/archive', async (req, res) => {
  try {
    if (typeof req.body.archived !== 'boolean') {
      return res.status(400).json({ error: 'archived 必须是布尔值' })
    }
    res.json(await chatService.setConversationArchived(req.params.id, req.user.userId, req.body.archived))
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '归档状态保存失败' })
  }
})

// 她主动说的话（到点提醒、她来想你、每周的信）只有对话这一个出口；没有推送通道，打开时拉取。
router.get('/nudges', async (req, res) => {
  try {
    res.json({ nudges: await nudgeService.listNudges(req.user.userId) })
  } catch (error) {
    logger.error('获取她想说的话失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取她想说的话失败' })
  }
})

router.post('/nudges/:id/ack', async (req, res) => {
  try {
    res.json(await nudgeService.ackNudge(req.user.userId, req.params.id, req.body?.action))
  } catch (error) {
    logger.error('确认她说的话失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '确认失败' })
  }
})

// 空白对话那一屏的开场话题：从她自己的线索里来（她惦记的事、你在读的书、最近的手记）。
// 只读、不发模型、不落库；取不到就让前端留着本机静态池。
router.get('/openers', async (req, res) => {
  try {
    res.json({ openers: await openerService.listOpeners(req.user.userId) })
  } catch (error) {
    logger.error('获取开场话题失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取开场话题失败' })
  }
})

// 只有一段对话：第一次打开时把旧的多个会话合成一段
router.get('/thread', async (req, res) => {
  try {
    res.json(await chatService.getThread(req.user.userId, {
      page: Number.parseInt(req.query.page, 10),
      limit: Number.parseInt(req.query.limit, 10),
    }))
  } catch (error) {
    logger.error('获取对话失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取对话失败' })
  }
})

router.delete('/thread/messages', async (req, res) => {
  try {
    res.json(await chatService.clearThread(req.user.userId))
  } catch (error) {
    logger.error('清空聊天记录失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '清空聊天记录失败' })
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
  const controller = new AbortController()
  const handleClose = () => { if (!res.writableEnded) controller.abort() }
  res.on('close', handleClose)
  try {
    const result = await chatService.sendMessage(
      req.params.id,
      req.user.userId,
      req.body.content,
      req.requestId,
      { signal: controller.signal },
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
    if (!controller.signal.aborted) res.status(statusCode).json(body)
  } finally {
    res.off('close', handleClose)
  }
})

// 伴读问答：书在用户自己的浏览器里，这里只收书的 id 和她此刻看到的那一段原文（服务端再截断）。
// multipart 轮（发图/传文件）不带伴读上下文，只认 JSON 对象。
const readingContext = (reading) => {
  if (!reading || typeof reading !== 'object' || typeof reading.bookId !== 'string' || !reading.bookId) return null
  return {
    bookId: reading.bookId,
    passage: typeof reading.passage === 'string' ? reading.passage : '',
  }
}

const STREAM_HEARTBEAT_MS = 15000

// 事件编码：data: {"event": <类型>, ...payload}\n\n（类型在 JSON 的 event 字段中，
// 不使用 SSE event: 行），心跳为注释帧 `: ping\n\n`。
// error 事件只携带固定 code，绝不包含对话内容。
router.post('/conversations/:id/messages/stream', workMessageUpload, async (req, res) => {
  // multipart 场景 content 可为空（纯图消息）；错误体形状对齐 utils/validate.js 的 validate() 400 输出
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : ''
  if (!req.file && !req.workFiles?.length) {
    const error = validateRequired(content, '消息内容') || validateLength(content, '消息内容', 1, 10000)
    if (error) return res.status(400).json({ error: '参数验证失败', details: [{ field: 'content', message: error }] })
  } else if (content.length > 10000) {
    return res.status(400).json({ error: '参数验证失败', details: [{ field: 'content', message: validateLength(content, '消息内容', 1, 10000) }] })
  }
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
      content,
      req.requestId,
      {
        signal: controller.signal,
        image: req.file ? { buffer: req.file.buffer, mime: req.file.mimetype } : null,
        files: req.workFiles || [],
        reading: readingContext(req.body.reading),
      },
    )) {
      if (controller.signal.aborted) break
      switch (item.type) {
        case 'sentence':
          send('delta', { text: item.text })
          break
        case 'replace':
          send('replace', { content: item.content })
          break
        case 'tool_progress':
          send('tool_progress', { step: item.step, status: item.status, tool: item.tool, summary: item.summary, plan: item.plan, sources: item.sources })
          break
        case 'done':
          send('done', {
            status: 'ok',
            userMessage: item.userMessage,
            aiMessage: item.aiMessage,
            source: item.source,
            // 她想让你记住一件事：回复下面自动打开「帮我记住」确认卡
            offerMemory: item.offerMemory === true,
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

// 聊天内确认卡：改/删用户已写下的内容先落一条待确认提案（toolRuns 里的 pending 条目），
// 点头才执行（复用工具自己的 run，不建第二执行通道）；「不用」只把提案标记成没做。
// index 就是该消息 toolRuns 数组里的下标；pending 已清的提案不允许重复处理（同来信 decide 的 409 口径）。
async function loadPendingToolRun(req) {
  const message = await prisma.message.findFirst({
    where: { id: req.params.messageId, conversation: { userId: req.user.userId } },
    select: { id: true, toolRuns: true },
  })
  // 非本人消息一律「不存在」
  if (!message) throw new HttpError('消息不存在', 404)
  const toolRuns = Array.isArray(message.toolRuns) ? [...message.toolRuns] : []
  const index = Number(req.params.index)
  if (!Number.isInteger(index) || index < 0 || index >= toolRuns.length) throw new HttpError('这个动作已经不在了', 404)
  const entry = toolRuns[index]
  if (entry?.pending !== true || entry.processing) throw new HttpError('这个动作已经处理过了', 409)
  return { message, toolRuns, index, entry }
}

const MAX_TOOL_RUN_CAS_ATTEMPTS = 32

// JSON 数组按原值比较并更新：抢同一个动作只能成功一次；不同下标并发时重读再合并。
async function changeToolRun(req, replace) {
  for (let attempt = 0; attempt < MAX_TOOL_RUN_CAS_ATTEMPTS; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { message, toolRuns, index, entry } = await loadPendingToolRun(req)
    toolRuns[index] = replace(entry)
    // eslint-disable-next-line no-await-in-loop
    const changed = await prisma.message.updateMany({
      where: { id: message.id, toolRuns: { equals: message.toolRuns } },
      data: { toolRuns },
    })
    if (changed.count === 1) return { entry, index }
  }
  throw new HttpError('这个动作正在更新，请重试', 409)
}

async function finishToolRun(req, claimId, toolRun) {
  for (let attempt = 0; attempt < MAX_TOOL_RUN_CAS_ATTEMPTS; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const message = await prisma.message.findFirst({
      where: { id: req.params.messageId, conversation: { userId: req.user.userId } },
      select: { id: true, toolRuns: true },
    })
    const index = Number(req.params.index)
    const toolRuns = Array.isArray(message?.toolRuns) ? [...message.toolRuns] : []
    if (toolRuns[index]?.claimId !== claimId) throw new HttpError('这个动作已经处理过了', 409)
    toolRuns[index] = toolRun
    // eslint-disable-next-line no-await-in-loop
    const changed = await prisma.message.updateMany({
      where: { id: message.id, toolRuns: { equals: message.toolRuns } },
      data: { toolRuns },
    })
    if (changed.count === 1) return
  }
  throw new HttpError('保存动作结果失败', 500)
}

router.post('/messages/:messageId/tool-runs/:index/confirm', async (req, res) => {
  try {
    const userId = req.user.userId
    const claimId = randomUUID()
    const { entry } = await changeToolRun(req, (pending) => ({ ...pending, pending: false, processing: true, claimId, ok: false, summary: '正在确认，结果待核对' }))
    let toolRun
    let result = null
    let already = false
    try {
      const run = await runConfirmedTool(userId, entry.tool, entry.args || {})
      result = run.result ?? null
      toolRun = { tool: entry.tool, ok: run.ok !== false, summary: run.summary }
    } catch (error) {
      // 执行对象已经被别处删掉/不存在：照样清掉提案，如实说「已经不在了」（同来信 delete_memory 的 already 语义）
      if (error?.statusCode === 404) {
        already = true
        toolRun = { tool: entry.tool, ok: true, summary: '已经不在了' }
      } else {
        toolRun = { tool: entry.tool, ok: false, summary: error?.statusCode ? error.message : '操作失败' }
      }
    }
    await finishToolRun(req, claimId, toolRun)
    res.json({ ...(already ? { already: true } : {}), toolRun, ...(result !== null ? { result } : {}) })
  } catch (error) {
    logger.error('确认聊天动作失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '操作失败' })
  }
})

router.post('/messages/:messageId/tool-runs/:index/dismiss', async (req, res) => {
  try {
    const { entry } = await changeToolRun(req, (pending) => ({ tool: pending.tool, ok: true, dismissed: true, summary: '你没让做' }))
    const toolRun = { tool: entry.tool, ok: true, dismissed: true, summary: '你没让做' }
    res.json({ toolRun })
  } catch (error) {
    logger.error('取消聊天动作失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '操作失败' })
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
