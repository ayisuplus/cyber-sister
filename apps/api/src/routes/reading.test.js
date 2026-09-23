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
  logReading: vi.fn(),
  listRecentNotes: vi.fn(),
  listNotesBetween: vi.fn(),
  updateProgress: vi.fn(),
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

describe('笔记按日界查询', () => {
  it('GET /notes 带 from/to 透传 listNotesBetween，不带维持最近笔记口径', async () => {
    service.listNotesBetween.mockResolvedValue([{ id: 'n1', book: '活着' }])

    const ok = await request(app).get('/notes?from=2026-09-20&to=2026-09-20&book=活着')
    expect(ok.status).toBe(200)
    expect(ok.body.notes[0].book).toBe('活着')
    expect(service.listNotesBetween).toHaveBeenCalledWith('user-1', { from: '2026-09-20', to: '2026-09-20', bookTitle: '活着' })

    service.listRecentNotes.mockResolvedValue([])
    await request(app).get('/notes?limit=20')
    expect(service.listRecentNotes).toHaveBeenCalled()
  })
})

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

})

describe('手记时间线接口', () => {
  it('GET /notes 取最近的笔记；limit 与 before 透传', async () => {
    service.listRecentNotes.mockResolvedValue([{ id: 'n1', book: '活着', content: '有庆那段' }])
    const response = await request(app).get('/notes?limit=10&before=2026-09-21T00:00:00Z')
    expect(response.body).toEqual({ notes: [{ id: 'n1', book: '活着', content: '有庆那段' }] })
    expect(service.listRecentNotes).toHaveBeenCalledWith('user-1', { limit: 10, before: '2026-09-21T00:00:00Z' })
  })

  it('POST /notes 按书名记一笔，书不在书架由服务端自动放上去；校验失败透传 400', async () => {
    service.logReading.mockResolvedValue({ bookId: 'b1', title: '活着', currentPage: 30 })
    const ok = await request(app).post('/notes').send({ book: '活着', note: '有庆那段', page: 30 })
    expect(ok.body).toEqual({ bookId: 'b1', title: '活着', currentPage: 30 })
    expect(service.logReading).toHaveBeenCalledWith('user-1', { title: '活着', note: '有庆那段', page: 30 })

    service.logReading.mockRejectedValue(Object.assign(new Error('书名不能为空'), { statusCode: 400 }))
    const fail = await request(app).post('/notes').send({ note: '没有书名' })
    expect(fail.status).toBe(400)
    expect(fail.body).toEqual({ error: '书名不能为空' })
  })
})

describe('阅读进度接口', () => {
  it('PUT /books/:id/progress 只把 locator 与 percent 交给 service', async () => {
    service.updateProgress.mockResolvedValue({ id: 'b1', percent: 62, locator: '5:200' })

    const response = await request(app).put('/books/b1/progress').send({ locator: '5:200', percent: 62, status: 'finished' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ id: 'b1', percent: 62, locator: '5:200' })
    expect(service.updateProgress).toHaveBeenCalledWith('user-1', 'b1', { locator: '5:200', percent: 62 })
  })

  it('书不是自己的就 404，校验失败透传 400', async () => {
    service.updateProgress.mockRejectedValue(httpError('书籍不存在', 404))
    const missing = await request(app).put('/books/nope/progress').send({ percent: 10 })
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: '书籍不存在' })

    service.updateProgress.mockRejectedValue(httpError('进度必须是0到100之间的整数', 400))
    const bad = await request(app).put('/books/b1/progress').send({ percent: 999 })
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: '进度必须是0到100之间的整数' })
  })
})
