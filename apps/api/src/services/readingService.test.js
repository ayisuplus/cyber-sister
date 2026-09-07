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
  generateNoteComment,
  listBooks,
  listNotes,
  logReading,
  updateBook,
} from './readingService.js'

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

  it('reuses an existing note comment instead of calling the model again', async () => {
    mocks.noteFindFirst.mockResolvedValue({ ...NOTE, aiComment: '我在', aiCommentSource: 'qwen', book: BOOK })

    const result = await generateNoteComment('u1', 'n1', 'req-n1')

    expect(result).toEqual({ aiComment: '我在', source: 'qwen', reused: true })
    expect(mocks.generateCompanionNote).not.toHaveBeenCalled()
  })

  it('generates and persists a persona comment for uncommented notes', async () => {
    mocks.noteFindFirst.mockResolvedValue({ ...NOTE, book: BOOK })
    mocks.generateCompanionNote.mockResolvedValue({ content: '这段确实戳心，我陪你缓一缓。', source: 'qwen' })
    mocks.noteUpdate.mockImplementation(async ({ data }) => ({ ...NOTE, ...data }))

    const result = await generateNoteComment('u1', 'n1', 'req-n2')

    const [noteArgs, requestId, modelOptions] = mocks.generateCompanionNote.mock.calls[0]
    expect(noteArgs.persona).toBe('gentle')
    expect(noteArgs.instruction).toContain('活着')
    expect(noteArgs.instruction).toContain('第 30 页')
    expect(noteArgs.userText).toBe('有庆那段看得心里发紧')
    expect(requestId).toBe('req-n2')
    expect(modelOptions.allowExternal).toBe(false)
    expect(mocks.noteUpdate.mock.calls[0][0].data).toEqual({
      aiComment: '这段确实戳心，我陪你缓一缓。',
      aiCommentSource: 'qwen',
    })
    expect(result.reused).toBe(false)
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

  it('requires an existing note before commenting', async () => {
    mocks.noteFindFirst.mockResolvedValue(null)

    await expect(generateNoteComment('u1', 'missing', 'req-n9')).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.generateCompanionNote).not.toHaveBeenCalled()
  })

  it('logReading rejects an empty title', async () => {
    await expect(logReading('u1', { title: ' ' })).rejects.toMatchObject({ statusCode: 400, message: '书名不能为空' })
    expect(mocks.bookFindFirst).not.toHaveBeenCalled()
  })
})
