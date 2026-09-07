import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const service = vi.hoisted(() => ({
  listBooks: vi.fn(),
  addBook: vi.fn(),
  updateBook: vi.fn(),
  deleteBook: vi.fn(),
  listNotes: vi.fn(),
  addNote: vi.fn(),
  deleteNote: vi.fn(),
  generateNoteComment: vi.fn(),
  logReading: vi.fn(),
}))

vi.mock('../services/readingService.js', () => service)
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import readingRoutes from './reading.js'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', readingRoutes)

const httpError = (message, statusCode, code) => Object.assign(new Error(message), { statusCode, code })

beforeEach(() => vi.clearAllMocks())

describe('书架路由', () => {
  it('GET /books 返回列表，service 错误透传状态码', async () => {
    service.listBooks.mockResolvedValue([{ id: 'b1', title: '活着' }])
    const ok = await request(app).get('/books')
    expect(ok.status).toBe(200)
    expect(ok.body[0].title).toBe('活着')

    service.listBooks.mockRejectedValue(new Error('db down'))
    const fail = await request(app).get('/books')
    expect(fail.status).toBe(500)
    expect(fail.body).toEqual({ error: '获取书架失败' })
  })

  it('POST /books 创建成功，400 透传', async () => {
    service.addBook.mockResolvedValue({ id: 'b1', title: '活着' })
    const ok = await request(app).post('/books').send({ title: '活着' })
    expect(ok.status).toBe(200)
    expect(service.addBook).toHaveBeenCalledWith('user-1', { title: '活着' })

    service.addBook.mockRejectedValue(httpError('书名必须为1到100个字符', 400))
    const bad = await request(app).post('/books').send({ title: '' })
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: '书名必须为1到100个字符' })
  })

  it('PUT /books/:id 404 透传', async () => {
    service.updateBook.mockRejectedValue(httpError('书籍不存在', 404))
    const missing = await request(app).put('/books/none').send({ status: 'finished' })
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: '书籍不存在' })
  })

  it('DELETE /books/:id 返回 success', async () => {
    service.deleteBook.mockResolvedValue(undefined)
    const ok = await request(app).delete('/books/b1')
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ success: true })
  })
})

describe('笔记路由', () => {
  it('GET /books/:id/notes 返回列表', async () => {
    service.listNotes.mockResolvedValue([{ id: 'n1', content: '感想' }])
    const ok = await request(app).get('/books/b1/notes')
    expect(ok.status).toBe(200)
    expect(service.listNotes).toHaveBeenCalledWith('user-1', 'b1')
  })

  it('POST /books/:id/notes 400 透传', async () => {
    service.addNote.mockRejectedValue(httpError('感想必须为1到500个字符', 400))
    const bad = await request(app).post('/books/b1/notes').send({ content: '' })
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: '感想必须为1到500个字符' })
  })

  it('DELETE /notes/:noteId 404 透传', async () => {
    service.deleteNote.mockRejectedValue(httpError('笔记不存在', 404))
    const missing = await request(app).delete('/notes/none')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: '笔记不存在' })
  })

  it('POST /notes/:noteId/comment 成功与本地模型未配置 code 透传', async () => {
    service.generateNoteComment.mockResolvedValue({ aiComment: '我在', source: 'local_model', reused: false })
    const ok = await request(app).post('/notes/n1/comment')
    expect(ok.status).toBe(200)
    expect(ok.body.aiComment).toBe('我在')

    service.generateNoteComment.mockRejectedValue(httpError('本地模型未配置', 503, 'LOCAL_LLM_NOT_CONFIGURED'))
    const fail = await request(app).post('/notes/n1/comment')
    expect(fail.status).toBe(503)
    expect(fail.body).toEqual({ error: '本地模型未配置', code: 'LOCAL_LLM_NOT_CONFIGURED' })
  })
})
