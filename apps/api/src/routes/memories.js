import { Router } from 'express'
import * as memoryService from '../services/memoryService.js'
import * as memorySuggestionService from '../services/memorySuggestionService.js'
import * as embeddingService from '../services/embeddingService.js'
import * as indexService from '../services/memoryIndexService.js'
import logger from '../utils/logger.js'

const router = Router()

function sendError(res, error, fallback) {
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : fallback,
    ...(error.code ? { code: error.code } : {}),
  })
}

router.post('/', async (req, res) => {
  try {
    const origin = req.body?.origin === 'suggestion' ? 'suggestion' : 'manual'
    const { type, content, importance, tags, sourceRef } = req.body ?? {}
    const memory = await memoryService.createMemory(req.user.userId, { type, content, importance, tags, origin, sourceRef: origin === 'suggestion' ? sourceRef : null })
    res.status(201).json(memory)
  } catch (error) {
    logger.error('创建记忆失败', { errorCode: error.code || error.name, userId: req.user.userId })
    sendError(res, error, '创建记忆失败')
  }
})

// 按需记忆建议（W3）：候选为本地模型临时生成，不落库，用户确认后才可经 POST / 创建
router.post('/suggestions', async (req, res) => {
  try {
    const result = await memorySuggestionService.getMemorySuggestions(
      req.user.userId,
      req.body?.messageId,
      req.requestId,
    )
    res.json(result)
  } catch (error) {
    logger.error('生成记忆建议失败', { errorCode: error.code || error.name, userId: req.user.userId })
    sendError(res, error, '生成记忆建议失败')
  }
})

// 语义索引重建（M2）：向量投影可重建，同意门与计数由 embeddingService 保证
router.post('/embeddings/rebuild', async (req, res) => {
  try {
    const result = await embeddingService.rebuildEmbeddings(req.user.userId)
    res.status(202).json(result)
  } catch (error) {
    logger.error('重建语义索引失败', { errorCode: error.code || error.name, userId: req.user.userId })
    sendError(res, error, '重建语义索引失败')
  }
})

router.get('/', async (req, res) => {
  try {
    const { type, q, page, limit } = req.query
    const result = await memoryService.listMemories(req.user.userId, {
      type,
      q,
      page: Number.parseInt(page, 10),
      limit: Number.parseInt(limit, 10),
    })
    res.json(result)
  } catch (error) {
    logger.error('获取记忆列表失败', { errorCode: error.code || error.name, userId: req.user.userId })
    sendError(res, error, '获取记忆列表失败')
  }
})

router.post('/index-jobs', async (req, res) => {
  try { res.status(202).json(await indexService.createIndexJob(req.user.userId, req.body ?? {})) }
  catch (error) { sendError(res, error, '创建索引任务失败') }
})
router.get('/index-jobs/latest', async (req, res) => {
  try { res.json(await indexService.latestIndexJob(req.user.userId)) }
  catch (error) { sendError(res, error, '读取索引任务失败') }
})
router.get('/index-jobs/:id', async (req, res) => {
  try { res.json(await indexService.getIndexJob(req.user.userId, req.params.id)) }
  catch (error) { sendError(res, error, '读取索引任务失败') }
})
router.post('/index-jobs/:id/cancel', async (req, res) => {
  try { res.json(await indexService.cancelIndexJob(req.user.userId, req.params.id)) }
  catch (error) { sendError(res, error, '取消索引任务失败') }
})
router.get('/:id', async (req, res) => {
  try { res.json(await memoryService.getMemory(req.user.userId, req.params.id)) }
  catch (error) { sendError(res, error, '读取记忆失败') }
})
router.get('/:id/revisions', async (req, res) => {
  try { res.json({ revisions: await memoryService.listRevisions(req.user.userId, req.params.id) }) }
  catch (error) { sendError(res, error, '读取记忆版本失败') }
})
router.post('/:id/restore', async (req, res) => {
  try { res.json(await memoryService.restoreMemory(req.user.userId, req.params.id, req.body)) }
  catch (error) { sendError(res, error, '恢复记忆失败') }
})

router.put('/:id', async (req, res) => {
  try {
    const memory = await memoryService.updateMemory(req.user.userId, req.params.id, req.body)
    res.json(memory)
  } catch (error) {
    logger.error('编辑记忆失败', { errorCode: error.code || error.name, userId: req.user.userId })
    sendError(res, error, '编辑记忆失败')
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await memoryService.deleteMemory(req.user.userId, req.params.id)
    res.json({ success: true })
  } catch (error) {
    logger.error('删除记忆失败', { errorCode: error.code || error.name, userId: req.user.userId })
    sendError(res, error, '删除记忆失败')
  }
})

router.delete('/', async (req, res) => {
  try {
    const deleted = await memoryService.clearAllMemories(req.user.userId)
    res.json({ success: true, deleted })
  } catch (error) {
    logger.error('清空记忆失败', { errorCode: error.code || error.name, userId: req.user.userId })
    sendError(res, error, '清空记忆失败')
  }
})

export default router
