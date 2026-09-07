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

router.delete('/books/:id', async (req, res) => {
  try {
    await readingService.deleteBook(req.user.userId, req.params.id)
    res.json({ success: true })
  } catch (error) {
    logger.error('删除书籍失败', { error: error.message })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '删除书籍失败' })
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

router.post('/notes/:noteId/comment', async (req, res) => {
  try {
    const result = await readingService.generateNoteComment(req.user.userId, req.params.noteId, req.requestId)
    res.json(result)
  } catch (error) {
    logger.error('生成笔记回应失败', { errorCode: error.code || error.name })
    const statusCode = error.statusCode || 500
    const body = {
      error: error.statusCode ? error.message : '生成回应失败',
      ...(error.statusCode && error.code ? { code: error.code } : {}),
    }
    res.status(statusCode).json(body)
  }
})

export default router
