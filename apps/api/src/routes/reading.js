import { Router } from 'express'
import * as readingService from '../services/readingService.js'
import logger from '../utils/logger.js'

const router = Router()

router.get('/books', async (req, res) => {
  try {
    const books = await readingService.listBooks(req.user.userId)
    res.json(books)
  } catch (error) {
    logger.error('获取书架失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取书架失败' })
  }
})

router.post('/books', async (req, res) => {
  try {
    const book = await readingService.addBook(req.user.userId, req.body)
    res.json(book)
  } catch (error) {
    logger.error('添加书籍失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '添加书籍失败' })
  }
})

router.put('/books/:id', async (req, res) => {
  try {
    const book = await readingService.updateBook(req.user.userId, req.params.id, req.body)
    res.json(book)
  } catch (error) {
    logger.error('更新书籍失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '更新书籍失败' })
  }
})

// 阅读器一边读一边回存进度：只动 locator/percent，不碰状态与页码
router.put('/books/:id/progress', async (req, res) => {
  try {
    const book = await readingService.updateProgress(req.user.userId, req.params.id, {
      locator: req.body?.locator,
      percent: req.body?.percent,
    })
    res.json(book)
  } catch (error) {
    logger.error('保存阅读进度失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '保存阅读进度失败' })
  }
})

router.delete('/books/:id', async (req, res) => {
  try {
    await readingService.deleteBook(req.user.userId, req.params.id)
    res.json({ success: true })
  } catch (error) {
    logger.error('删除书籍失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '删除书籍失败' })
  }
})

// 手记时间线：最近的读书笔记（带书名），以及按书名直接记一笔（书不在书架会自动放上去）
router.get('/notes', async (req, res) => {
  try {
    // 带 from/to 就按日界取跨书笔记（「那天的记录」用）；否则维持最近笔记的原有口径
    const ranged = req.query.from !== undefined || req.query.to !== undefined
    const notes = ranged
      ? await readingService.listNotesBetween(req.user.userId, { from: req.query.from, to: req.query.to, bookTitle: req.query.book })
      : await readingService.listRecentNotes(req.user.userId, { limit: Number.parseInt(req.query.limit, 10), before: req.query.before })
    res.json({ notes })
  } catch (error) {
    logger.error('获取读书笔记失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取读书笔记失败' })
  }
})

router.post('/notes', async (req, res) => {
  try {
    res.json(await readingService.logReading(req.user.userId, { title: req.body?.book, note: req.body?.note, page: req.body?.page }))
  } catch (error) {
    logger.error('记录读书笔记失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '记录读书笔记失败' })
  }
})

router.get('/books/:id/notes', async (req, res) => {
  try {
    const notes = await readingService.listNotes(req.user.userId, req.params.id)
    res.json(notes)
  } catch (error) {
    logger.error('获取笔记失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取笔记失败' })
  }
})

router.post('/books/:id/notes', async (req, res) => {
  try {
    const result = await readingService.addNote(req.user.userId, req.params.id, req.body)
    res.json(result)
  } catch (error) {
    logger.error('记录感想失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '记录感想失败' })
  }
})

router.delete('/notes/:noteId', async (req, res) => {
  try {
    await readingService.deleteNote(req.user.userId, req.params.noteId)
    res.json({ success: true })
  } catch (error) {
    logger.error('删除笔记失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '删除笔记失败' })
  }
})

export default router
