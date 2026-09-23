import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  bookFindMany: vi.fn(),
  bookFindFirst: vi.fn(),
  bookCreate: vi.fn(),
  bookUpdate: vi.fn(),
  bookDelete: vi.fn(),
  noteFindFirst: vi.fn(),
  noteFindMany: vi.fn(),
  noteCreate: vi.fn(),
  noteUpdate: vi.fn(),
  noteDelete: vi.fn(),
  userFindUnique: vi.fn(),
  generateCompanionNote: vi.fn(),
}))

vi.mock('../prisma/client.js', () => ({
  default: {
    book: {
      findMany: mocks.bookFindMany,
      findFirst: mocks.bookFindFirst,
      create: mocks.bookCreate,
      update: mocks.bookUpdate,
      delete: mocks.bookDelete,
    },
    readingNote: {
      findFirst: mocks.noteFindFirst,
      findMany: mocks.noteFindMany,
      create: mocks.noteCreate,
      update: mocks.noteUpdate,
      delete: mocks.noteDelete,
    },
    user: { findUnique: mocks.userFindUnique },
  },
}))

vi.mock('./llmService.js', () => ({
  generateCompanionNote: mocks.generateCompanionNote,
}))

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  addBook,
  addNote,
  deleteBook,
  deleteNote,
  listBooks,
  listNotes,
  listNotesBetween,
  listRecentNotes,
  logReading,
  updateBook,
  updateProgress,
} from './readingService.js'

describe('listNotesBetween 按日界取跨书笔记', () => {
  it('只回日界内（含当天）的笔记，按新到旧、带书名与 locator', async () => {
    mocks.noteFindMany.mockResolvedValue([
      { id: 'n2', bookId: 'b1', userId: 'u1', page: 30, content: '当天那条', quote: '原文', locator: '3:10',
        aiComment: null, aiCommentSource: null, createdAt: new Date('2026-09-20T05:00:00Z'), book: { title: '活着' } },
    ])

    const notes = await listNotesBetween('u1', { from: '2026-09-20', to: '2026-09-20' })

    expect(mocks.noteFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'u1' }),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
    }))
    const where = mocks.noteFindMany.mock.lastCall[0].where
    expect(where.createdAt.gte).toEqual(new Date('2026-09-20T00:00:00.000Z'))
    expect(where.createdAt.lt).toEqual(new Date('2026-09-21T00:00:00.000Z'))
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ book: '活着', locator: '3:10', content: '当天那条' })
  })

  it('bookTitle 精确匹配书名；全缺省取最近 20 条', async () => {
    mocks.noteFindMany.mockResolvedValue([])

    await listNotesBetween('u1', { bookTitle: '活着' })
    expect(mocks.noteFindMany.mock.lastCall[0].where).toMatchObject({ book: { title: '活着' } })
    expect(mocks.noteFindMany.mock.lastCall[0].take).toBe(20)

    await listNotesBetween('u1')
    expect(mocks.noteFindMany.mock.lastCall[0].where).toEqual({ userId: 'u1' })
  })

  it('结束日早于开始日报 400，非法日期报 400', async () => {
    await expect(listNotesBetween('u1', { from: '2026-09-21', to: '2026-09-20' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(listNotesBetween('u1', { from: '2026-9-20' })).rejects.toMatchObject({ statusCode: 400 })
  })
})

const BOOK = {
  id: 'b1',
  userId: 'u1',
  title: '活着',
  author: '余华',
  status: 'reading',
  totalPages: 200,
  currentPage: 30,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
}

const NOTE = {
  id: 'n1',
  bookId: 'b1',
  userId: 'u1',
  page: 30,
  content: '有庆那段看得心里发紧',
  aiComment: null,
  aiCommentSource: null,
  createdAt: new Date('2026-09-02T00:00:00.000Z'),
}

describe('readingService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.userFindUnique.mockResolvedValue({
      persona: 'gentle',
      externalLlmConsent: null,
      externalLlmConsentVersion: null,
    })
  })

  it('rejects empty title, bad totalPages and bad status on addBook', async () => {
    await expect(addBook('u1', { title: '  ' })).rejects.toMatchObject({ statusCode: 400, message: '书名必须为1到100个字符' })
    await expect(addBook('u1', { title: '活着', totalPages: 0 })).rejects.toMatchObject({ statusCode: 400, message: '总页数必须是正整数' })
    await expect(addBook('u1', { title: '活着', status: 'abandoned' })).rejects.toMatchObject({ statusCode: 400, message: '状态必须是想读、在读或读完之一' })
    expect(mocks.bookCreate).not.toHaveBeenCalled()
  })

  it('addNote advances currentPage and flips want to reading', async () => {
    mocks.bookFindFirst.mockResolvedValue({ ...BOOK, status: 'want', currentPage: 10 })
    mocks.noteCreate.mockImplementation(async ({ data }) => ({ ...NOTE, ...data }))
    mocks.bookUpdate.mockImplementation(async ({ data }) => ({ ...BOOK, status: 'want', currentPage: 10, ...data }))

    const result = await addNote('u1', 'b1', { content: '看到这里了', page: 42 })

    expect(mocks.bookUpdate).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { currentPage: 42, status: 'reading' } })
    expect(result.book.currentPage).toBe(42)
    expect(result.book.status).toBe('reading')
  })

  it('rejects a note page beyond totalPages', async () => {
    mocks.bookFindFirst.mockResolvedValue(BOOK)

    await expect(addNote('u1', 'b1', { content: '感想', page: 201 }))
      .rejects.toMatchObject({ statusCode: 400, message: '页码超出总页数' })
    expect(mocks.noteCreate).not.toHaveBeenCalled()
  })

  it('logReading shelves a missing book and records a note', async () => {
    mocks.bookFindFirst
      .mockResolvedValueOnce(null) // 按书名查找：没有
      .mockResolvedValueOnce({ ...BOOK, status: 'reading', currentPage: 0 }) // addNote 内的 findOwned
    mocks.bookCreate.mockResolvedValue({ ...BOOK, currentPage: 0 })
    mocks.noteCreate.mockImplementation(async ({ data }) => ({ ...NOTE, ...data }))
    mocks.bookUpdate.mockImplementation(async ({ data }) => ({ ...BOOK, ...data }))

    const result = await logReading('u1', { title: '活着', page: 30, note: '有庆那段看得心里发紧' })

    expect(mocks.bookCreate).toHaveBeenCalled()
    expect(mocks.noteCreate).toHaveBeenCalled()
    expect(result).toMatchObject({ bookId: 'b1', title: '活着', currentPage: 30 })
  })

  it('logReading reuses an existing book on exact title match', async () => {
    mocks.bookFindFirst.mockResolvedValue(BOOK)

    const result = await logReading('u1', { title: '活着' })

    expect(mocks.bookCreate).not.toHaveBeenCalled()
    expect(result).toEqual({ bookId: 'b1', title: '活着', currentPage: 30 })
  })

  it('lists books with note counts', async () => {
    mocks.bookFindMany.mockResolvedValue([{ ...BOOK, _count: { notes: 2 } }])

    const books = await listBooks('u1')

    expect(books).toHaveLength(1)
    expect(books[0]).toMatchObject({ id: 'b1', title: '活着', noteCount: 2, currentPage: 30 })
  })

  it('addBook stores author, totalPages and explicit status', async () => {
    mocks.bookCreate.mockImplementation(async ({ data }) => ({ ...data, id: 'b2', createdAt: new Date() }))

    const book = await addBook('u1', { title: ' 活着 ', author: '余华', totalPages: 200, status: 'want' })

    expect(mocks.bookCreate.mock.calls[0][0].data).toMatchObject({ title: '活着', author: '余华', totalPages: 200, status: 'want' })
    expect(book.status).toBe('want')
  })

  it('rejects an overlong author name', async () => {
    await expect(addBook('u1', { title: '活着', author: '作'.repeat(51) }))
      .rejects.toMatchObject({ statusCode: 400, message: '作者名不能超过50个字符' })
  })

  it('updateBook validates currentPage and auto-fills progress on finished', async () => {
    mocks.bookFindFirst.mockResolvedValue(BOOK)

    await expect(updateBook('u1', 'b1', { currentPage: -1 }))
      .rejects.toMatchObject({ statusCode: 400, message: '当前页必须是非负整数' })
    await expect(updateBook('u1', 'b1', { currentPage: 201 }))
      .rejects.toMatchObject({ statusCode: 400, message: '当前页不能超过总页数' })
    expect(mocks.bookUpdate).not.toHaveBeenCalled()

    mocks.bookUpdate.mockImplementation(async ({ data }) => ({ ...BOOK, ...data }))
    const finished = await updateBook('u1', 'b1', { status: 'finished' })
    expect(mocks.bookUpdate).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { status: 'finished', currentPage: 200 } })
    expect(finished.currentPage).toBe(200)

    const moved = await updateBook('u1', 'b1', { currentPage: 50, title: '活着（新版）' })
    expect(mocks.bookUpdate).toHaveBeenLastCalledWith({ where: { id: 'b1' }, data: { title: '活着（新版）', currentPage: 50 } })
    expect(moved.currentPage).toBe(50)
  })

  it('updateBook 404s for a foreign book', async () => {
    mocks.bookFindFirst.mockResolvedValue(null)

    await expect(updateBook('u1', 'b1', { status: 'finished' })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('deletes an owned book and rejects foreign deletes', async () => {
    mocks.bookFindFirst.mockResolvedValue(BOOK)
    await deleteBook('u1', 'b1')
    expect(mocks.bookDelete).toHaveBeenCalledWith({ where: { id: 'b1' } })

    mocks.bookFindFirst.mockResolvedValue(null)
    await expect(deleteBook('u1', 'b1')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rejects empty note content and non-integer pages', async () => {
    mocks.bookFindFirst.mockResolvedValue(BOOK)

    await expect(addNote('u1', 'b1', { content: '  ' }))
      .rejects.toMatchObject({ statusCode: 400, message: '感想必须为1到500个字符' })
    await expect(addNote('u1', 'b1', { content: '感想', page: 1.5 }))
      .rejects.toMatchObject({ statusCode: 400, message: '页码必须是正整数' })
    expect(mocks.noteCreate).not.toHaveBeenCalled()
  })

  it('keeps currentPage when the note page does not advance it', async () => {
    mocks.bookFindFirst.mockResolvedValue(BOOK)
    mocks.noteCreate.mockImplementation(async ({ data }) => ({ ...NOTE, ...data }))

    const result = await addNote('u1', 'b1', { content: '回头重读这段', page: 10 })

    expect(mocks.bookUpdate).not.toHaveBeenCalled()
    expect(result.book.currentPage).toBe(30)
  })

  it('lists and deletes notes with ownership scoping', async () => {
    mocks.bookFindFirst.mockResolvedValue(BOOK)
    mocks.noteFindMany.mockResolvedValue([NOTE])

    const notes = await listNotes('u1', 'b1')
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ id: 'n1', page: 30 })

    mocks.noteFindFirst.mockResolvedValue(NOTE)
    await deleteNote('u1', 'n1')
    expect(mocks.noteDelete).toHaveBeenCalledWith({ where: { id: 'n1' } })

    mocks.noteFindFirst.mockResolvedValue(null)
    await expect(deleteNote('u1', 'n1')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('logReading rejects an empty title', async () => {
    await expect(logReading('u1', { title: ' ' })).rejects.toMatchObject({ statusCode: 400, message: '书名不能为空' })
    expect(mocks.bookFindFirst).not.toHaveBeenCalled()
  })
})

describe('手记时间线用的最近笔记', () => {
  it('按时间倒序取，带上书名，可以继续往更早翻', async () => {
    mocks.noteFindMany.mockResolvedValue([
      { id: 'n2', bookId: 'b1', page: 30, content: '有庆那段', createdAt: new Date('2026-09-20T10:00:00Z'), book: { title: '活着' } },
      { id: 'n1', bookId: 'b1', page: null, content: '开头', createdAt: new Date('2026-09-19T10:00:00Z'), book: { title: '活着' } },
    ])

    const notes = await listRecentNotes('u1', { limit: 2, before: '2026-09-21T00:00:00Z' })

    expect(notes.map((note) => note.id)).toEqual(['n2', 'n1'])
    expect(notes[0]).toMatchObject({ book: '活着', page: 30, content: '有庆那段' })
    expect(mocks.noteFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1', createdAt: { lt: new Date('2026-09-21T00:00:00Z') } },
      take: 2,
      include: { book: { select: { title: true } } },
    }))
  })

  it('条数封顶 100，before 不是时间就拒绝', async () => {
    mocks.noteFindMany.mockResolvedValue([])
    await listRecentNotes('u1', { limit: 500 })
    expect(mocks.noteFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }))
    await expect(listRecentNotes('u1', { before: '不是时间' })).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('书架与伴读：书在浏览器里，这里只记进度', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('addBook 收下格式、文件名与进度，非法格式直接拒绝', async () => {
    mocks.bookCreate.mockImplementation(({ data }) => Promise.resolve({ ...BOOK, ...data }))

    const book = await addBook('u1', { title: '活着', format: 'epub', fileName: 'huozhe.epub', percent: 12, locator: '3:1024' })

    expect(mocks.bookCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ format: 'epub', fileName: 'huozhe.epub', percent: 12, locator: '3:1024' }),
    }))
    expect(book).toMatchObject({ format: 'epub', fileName: 'huozhe.epub', percent: 12 })

    await expect(addBook('u1', { title: '活着', format: 'pdf' }))
      .rejects.toMatchObject({ statusCode: 400, message: '格式只支持 epub 或 txt' })
  })

  it('updateProgress 只动进度，想读的书一开读就转为在读', async () => {
    mocks.bookFindFirst.mockResolvedValue({ ...BOOK, status: 'want' })
    mocks.bookUpdate.mockImplementation(({ data }) => Promise.resolve({ ...BOOK, ...data }))

    const book = await updateProgress('u1', 'b1', { locator: '5:200', percent: 62 })

    expect(mocks.bookUpdate).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { locator: '5:200', percent: 62, status: 'reading' } })
    expect(book).toMatchObject({ locator: '5:200', percent: 62, status: 'reading' })
  })

  it('读到 100% 也不自动标记读完', async () => {
    mocks.bookFindFirst.mockResolvedValue(BOOK)
    mocks.bookUpdate.mockImplementation(({ data }) => Promise.resolve({ ...BOOK, ...data }))

    const book = await updateProgress('u1', 'b1', { percent: 100 })

    expect(book.status).toBe('reading')
    expect(mocks.bookUpdate).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { percent: 100 } })
  })

  it('进度越界或什么都没给都拒绝', async () => {
    mocks.bookFindFirst.mockResolvedValue(BOOK)

    await expect(updateProgress('u1', 'b1', { percent: 101 }))
      .rejects.toMatchObject({ statusCode: 400, message: '进度必须是0到100之间的整数' })
    await expect(updateProgress('u1', 'b1', {}))
      .rejects.toMatchObject({ statusCode: 400, message: '没有要保存的进度' })
    expect(mocks.bookUpdate).not.toHaveBeenCalled()
  })

  it('笔记带上原文与位置；从问答记下来时她的回答标成 chat', async () => {
    mocks.bookFindFirst.mockResolvedValue(BOOK)
    mocks.noteCreate.mockImplementation(({ data }) => Promise.resolve({ ...NOTE, ...data }))

    const { note } = await addNote('u1', 'b1', {
      content: '她为什么不肯走？',
      quote: '有庆躺在那里',
      locator: '3:1024',
      aiComment: '因为她还在等。',
    })

    expect(note).toMatchObject({ quote: '有庆躺在那里', locator: '3:1024', aiComment: '因为她还在等。', aiCommentSource: 'chat' })
  })

  it('没有她的回应时来源留空，不假装有', async () => {
    mocks.bookFindFirst.mockResolvedValue(BOOK)
    mocks.noteCreate.mockImplementation(({ data }) => Promise.resolve({ ...NOTE, ...data }))

    const { note } = await addNote('u1', 'b1', { content: '写一句自己的' })

    expect(note.aiComment).toBeNull()
    expect(note.aiCommentSource).toBeNull()
  })

  it('聊天里只报页码不写感想时只推进度，不再报错', async () => {
    mocks.bookFindFirst
      .mockResolvedValueOnce(BOOK) // 按书名找到
      .mockResolvedValueOnce(BOOK) // updateBook 内的 findOwned
    mocks.bookUpdate.mockImplementation(({ data }) => Promise.resolve({ ...BOOK, ...data }))

    const result = await logReading('u1', { title: '活着', page: 88 })

    expect(mocks.noteCreate).not.toHaveBeenCalled()
    expect(mocks.bookUpdate).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { currentPage: 88 } })
    expect(result).toMatchObject({ currentPage: 88 })
  })

  it('聊天里报的页码必须从 1 起', async () => {
    mocks.bookFindFirst.mockResolvedValue(BOOK)

    await expect(logReading('u1', { title: '活着', page: 0 }))
      .rejects.toMatchObject({ statusCode: 400, message: '页码必须是正整数' })
    expect(mocks.bookUpdate).not.toHaveBeenCalled()
  })
})
