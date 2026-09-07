/**
 * 陪伴阅读服务：书架（想读/在读/读完）、页码进度、一句话感想笔记，
 * 每条笔记可生成幂等的姐妹人格化短评（脱敏、同意门与日记一致）。
 * 笔记不可编辑只可删，短评不会因内容变化失效。
 */
import prisma from '../prisma/client.js'
import { findOwned, HttpError } from '../utils/dbHelpers.js'
import { generateCompanionNote } from './llmService.js'
import { buildUserModelOptions } from './userModelOptions.js'
import logger from '../utils/logger.js'

export const BOOK_STATUSES = new Set(['want', 'reading', 'finished'])
const TITLE_MAX = 100
const AUTHOR_MAX = 50
const NOTE_MAX = 500

function validateTitle(title) {
  if (typeof title !== 'string' || !title.trim() || title.trim().length > TITLE_MAX) {
    throw new HttpError(`书名必须为1到${TITLE_MAX}个字符`, 400)
  }
  return title.trim()
}

function validateAuthor(author) {
  if (author === undefined || author === null) return null
  const trimmed = String(author).trim()
  if (trimmed.length > AUTHOR_MAX) throw new HttpError(`作者名不能超过${AUTHOR_MAX}个字符`, 400)
  return trimmed || null
}

function validateTotalPages(totalPages) {
  if (totalPages === undefined || totalPages === null) return null
  if (!Number.isInteger(totalPages) || totalPages < 1) throw new HttpError('总页数必须是正整数', 400)
  return totalPages
}

function validateStatus(status) {
  if (!BOOK_STATUSES.has(status)) throw new HttpError('状态必须是想读、在读或读完之一', 400)
  return status
}

function serializeBook(b) {
  return {
    id: b.id,
    title: b.title,
    author: b.author,
    status: b.status,
    totalPages: b.totalPages,
    currentPage: b.currentPage,
    noteCount: b._count?.notes ?? 0,
    createdAt: b.createdAt,
  }
}

function serializeNote(n) {
  return {
    id: n.id,
    bookId: n.bookId,
    page: n.page,
    content: n.content,
    aiComment: n.aiComment,
    aiCommentSource: n.aiCommentSource,
    createdAt: n.createdAt,
  }
}

export async function listBooks(userId) {
  const books = await prisma.book.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { notes: true } } },
  })
  return books.map(serializeBook)
}

export async function addBook(userId, { title, author, totalPages, status }) {
  const book = await prisma.book.create({
    data: {
      userId,
      title: validateTitle(title),
      author: validateAuthor(author),
      totalPages: validateTotalPages(totalPages),
      status: status === undefined ? 'reading' : validateStatus(status),
    },
  })
  logger.info('添加书籍', { userId })
  return serializeBook(book)
}

export async function updateBook(userId, bookId, { status, currentPage, totalPages, author, title }) {
  const book = await findOwned('book', bookId, userId, '书籍')
  const data = {}
  if (title !== undefined) data.title = validateTitle(title)
  if (author !== undefined) data.author = validateAuthor(author)
  if (totalPages !== undefined) data.totalPages = validateTotalPages(totalPages)
  if (status !== undefined) data.status = validateStatus(status)
  const knownTotal = data.totalPages !== undefined ? data.totalPages : book.totalPages
  if (currentPage !== undefined) {
    if (!Number.isInteger(currentPage) || currentPage < 0) throw new HttpError('当前页必须是非负整数', 400)
    if (knownTotal !== null && currentPage > knownTotal) throw new HttpError('当前页不能超过总页数', 400)
    data.currentPage = currentPage
  }
  // 标记读完且未显式给页码时，自动把进度推满
  if (data.status === 'finished' && knownTotal !== null && currentPage === undefined) {
    data.currentPage = knownTotal
  }
  const updated = await prisma.book.update({ where: { id: book.id }, data })
  logger.info('更新书籍', { userId })
  return serializeBook(updated)
}

export async function deleteBook(userId, bookId) {
  const book = await findOwned('book', bookId, userId, '书籍')
  await prisma.book.delete({ where: { id: book.id } })
  logger.info('删除书籍', { userId })
}

export async function addNote(userId, bookId, { content, page }) {
  const book = await findOwned('book', bookId, userId, '书籍')
  if (typeof content !== 'string' || !content.trim() || content.trim().length > NOTE_MAX) {
    throw new HttpError(`感想必须为1到${NOTE_MAX}个字符`, 400)
  }
  let safePage
  if (page !== undefined && page !== null) {
    if (!Number.isInteger(page) || page < 1) throw new HttpError('页码必须是正整数', 400)
    if (book.totalPages !== null && page > book.totalPages) throw new HttpError('页码超出总页数', 400)
    safePage = page
  }
  const note = await prisma.readingNote.create({
    data: { bookId: book.id, userId, content: content.trim(), page: safePage },
  })
  // 副作用：页码推进进度；想读的书记下第一条感想即转为在读
  const bookUpdate = {}
  if (safePage !== undefined && safePage > book.currentPage) bookUpdate.currentPage = safePage
  if (book.status === 'want') bookUpdate.status = 'reading'
  const updatedBook = Object.keys(bookUpdate).length
    ? await prisma.book.update({ where: { id: book.id }, data: bookUpdate })
    : book
  logger.info('记录阅读感想', { userId })
  return { note: serializeNote(note), book: serializeBook(updatedBook) }
}

export async function listNotes(userId, bookId) {
  const book = await findOwned('book', bookId, userId, '书籍')
  const notes = await prisma.readingNote.findMany({
    where: { bookId: book.id },
    orderBy: { createdAt: 'desc' },
  })
  return notes.map(serializeNote)
}

export async function deleteNote(userId, noteId) {
  const note = await findOwned('readingNote', noteId, userId, '笔记')
  await prisma.readingNote.delete({ where: { id: note.id } })
  logger.info('删除笔记', { userId })
}

/**
 * 为一条阅读笔记生成（或复用）AI 闺蜜回应。
 * 幂等：已有回应直接返回，不重复消耗模型；笔记不可编辑，无需失效逻辑。
 */
export async function generateNoteComment(userId, noteId, requestId) {
  const note = await prisma.readingNote.findFirst({ where: { id: noteId, userId }, include: { book: true } })
  if (!note) throw new HttpError('这条笔记不存在', 404)
  if (note.aiComment) {
    return { aiComment: note.aiComment, source: note.aiCommentSource, reused: true }
  }

  const { user, modelOptions } = await buildUserModelOptions(userId)
  const aiNote = await generateCompanionNote({
    persona: user.persona,
    instruction: `用户正在读《${note.book.title}》${note.page ? `，读到第 ${note.page} 页` : ''}，写下了一条读书感想。作为她的 AI 闺蜜，用 2-3 句话回应：接住她的感受或想法，可以轻轻往深处陪一句；不说教、不剧透、不评价她的理解对错。`,
    userText: note.content,
  }, requestId, modelOptions)

  const updated = await prisma.readingNote.update({
    where: { id: note.id },
    data: { aiComment: aiNote.content, aiCommentSource: aiNote.source },
  })
  logger.info('生成笔记回应', { userId, source: aiNote.source })
  return { aiComment: updated.aiComment, source: updated.aiCommentSource, reused: false }
}

/** 聊天工具用：按书名精确匹配书架，没有则自动上架（在读），可顺带记页码/感想。 */
export async function logReading(userId, { title, page, note }) {
  if (typeof title !== 'string' || !title.trim()) throw new HttpError('书名不能为空', 400)
  const safeTitle = title.trim()
  let book = await prisma.book.findFirst({
    where: { userId, title: safeTitle },
    orderBy: { updatedAt: 'desc' },
  })
  if (!book) book = await addBook(userId, { title: safeTitle })
  if (note !== undefined || page !== undefined) {
    const { book: updated } = await addNote(userId, book.id, { content: note, page })
    book = updated
  }
  return { bookId: book.id, title: book.title, currentPage: book.currentPage }
}
