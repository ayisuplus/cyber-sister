/**
 * 陪伴阅读服务：书架（想读/在读/读完）、阅读进度、一句话感想笔记。
 * 书本身留在用户自己的浏览器里（IndexedDB），这里只记她在读什么、读到哪儿、记了什么；
 * locator 是前端给的不透明进度串，服务端只存不解析。笔记不可编辑只可删。
 */
import prisma from '../prisma/client.js'
import { findOwned, HttpError } from '../utils/dbHelpers.js'
import { parseUtcDay } from '../utils/dayHelpers.js'
import logger from '../utils/logger.js'

const DAY_MS = 24 * 60 * 60 * 1000

export const BOOK_STATUSES = new Set(['want', 'reading', 'finished'])
export const BOOK_FORMATS = new Set(['epub', 'txt'])
const TITLE_MAX = 100
const AUTHOR_MAX = 50
const NOTE_MAX = 500
const FILE_NAME_MAX = 200
const LOCATOR_MAX = 200
const QUOTE_MAX = 1000
const AI_COMMENT_MAX = 1000

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

function validateFormat(format) {
  if (format === undefined || format === null) return null
  if (!BOOK_FORMATS.has(format)) throw new HttpError('格式只支持 epub 或 txt', 400)
  return format
}

/** 可空短文本的通用校验：空串归 null，超长即 400。 */
function validateText(value, max, label) {
  if (value === undefined || value === null) return null
  const trimmed = String(value).trim()
  if (trimmed.length > max) throw new HttpError(`${label}不能超过${max}个字符`, 400)
  return trimmed || null
}

function validatePercent(percent) {
  if (percent === undefined || percent === null) return null
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new HttpError('进度必须是0到100之间的整数', 400)
  }
  return percent
}

function serializeBook(b) {
  return {
    id: b.id,
    title: b.title,
    author: b.author,
    status: b.status,
    format: b.format ?? null,
    fileName: b.fileName ?? null,
    locator: b.locator ?? null,
    percent: b.percent ?? null,
    totalPages: b.totalPages,
    currentPage: b.currentPage,
    noteCount: b._count?.notes ?? 0,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  }
}

function serializeNote(n) {
  return {
    id: n.id,
    bookId: n.bookId,
    page: n.page,
    quote: n.quote ?? null,
    locator: n.locator ?? null,
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

export async function addBook(userId, { title, author, totalPages, status, format, fileName, locator, percent }) {
  const book = await prisma.book.create({
    data: {
      userId,
      title: validateTitle(title),
      author: validateAuthor(author),
      totalPages: validateTotalPages(totalPages),
      status: status === undefined ? 'reading' : validateStatus(status),
      format: validateFormat(format),
      fileName: validateText(fileName, FILE_NAME_MAX, '文件名'),
      locator: validateText(locator, LOCATOR_MAX, '进度位置'),
      percent: validatePercent(percent),
    },
  })
  logger.info('添加书籍', { userId })
  return serializeBook(book)
}

/** 给了才校验、才写：可选字段统一走这张表。 */
const BOOK_FIELDS = {
  title: validateTitle,
  author: validateAuthor,
  totalPages: validateTotalPages,
  status: validateStatus,
  format: validateFormat,
  fileName: (value) => validateText(value, FILE_NAME_MAX, '文件名'),
  locator: (value) => validateText(value, LOCATOR_MAX, '进度位置'),
  percent: validatePercent,
}

function changedFields(changes) {
  const data = {}
  for (const [field, validate] of Object.entries(BOOK_FIELDS)) {
    if (changes[field] !== undefined) data[field] = validate(changes[field])
  }
  return data
}

export async function updateBook(userId, bookId, changes) {
  const { currentPage } = changes
  const book = await findOwned('book', bookId, userId, '书籍')
  const data = changedFields(changes)
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

/**
 * 只推进度，不动别的：阅读器一边读一边回存。
 * 读到 100% 不会自动标记读完——那由用户自己点；但想读的书一旦开读就转为在读。
 */
export async function updateProgress(userId, bookId, { locator, percent }) {
  const book = await findOwned('book', bookId, userId, '书籍')
  if (locator === undefined && percent === undefined) throw new HttpError('没有要保存的进度', 400)
  const data = {}
  if (locator !== undefined) data.locator = validateText(locator, LOCATOR_MAX, '进度位置')
  if (percent !== undefined) data.percent = validatePercent(percent)
  if (book.status === 'want') data.status = 'reading'
  const updated = await prisma.book.update({ where: { id: book.id }, data })
  return serializeBook(updated)
}

export async function deleteBook(userId, bookId) {
  const book = await findOwned('book', bookId, userId, '书籍')
  await prisma.book.delete({ where: { id: book.id } })
  logger.info('删除书籍', { userId })
}

export async function addNote(userId, bookId, { content, page, quote, locator, aiComment }) {
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
  // 从伴读问答里记下来的一笔：她的回答原样留在 aiComment 上，来源如实标成 chat
  const safeComment = validateText(aiComment, AI_COMMENT_MAX, '她的回应')
  const note = await prisma.readingNote.create({
    data: {
      bookId: book.id,
      userId,
      content: content.trim(),
      page: safePage,
      quote: validateText(quote, QUOTE_MAX, '原文'),
      locator: validateText(locator, LOCATOR_MAX, '进度位置'),
      aiComment: safeComment,
      aiCommentSource: safeComment ? 'chat' : null,
    },
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

/** 手记时间线用：最近的读书笔记（新到旧），带上书名。 */
export async function listRecentNotes(userId, { limit = 50, before } = {}) {
  const take = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 50
  const cutoff = before ? new Date(before) : null
  if (cutoff && Number.isNaN(cutoff.getTime())) throw new HttpError('before 必须是时间', 400)
  const notes = await prisma.readingNote.findMany({
    where: { userId, ...(cutoff ? { createdAt: { lt: cutoff } } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
    include: { book: { select: { title: true } } },
  })
  return notes.map((note) => ({ ...serializeNote(note), book: note.book?.title ?? '' }))
}

/**
 * 按日界取跨书的读书笔记（新到旧，带书名）：手记页时间线与「那天的记录」用。
 * from/to 为 'yyyy-MM-dd'、含当天；日界按存储契约的 UTC 日历日（同 listRecentNotes 产出的 createdAt 口径）。
 * bookTitle 精确匹配书名；全缺省取最近 20 条。每条含 locator（「回到书里这一处」用）。
 */
export async function listNotesBetween(userId, { from, to, bookTitle } = {}) {
  const fromDay = from ? parseUtcDay(from) : null
  const toDay = to ? parseUtcDay(to) : null
  if (fromDay && toDay && toDay < fromDay) throw new HttpError('结束日期不能早于开始日期', 400)
  const upper = toDay ? new Date(toDay.getTime() + DAY_MS) : null
  const notes = await prisma.readingNote.findMany({
    where: {
      userId,
      ...(fromDay ? { createdAt: { gte: fromDay } } : {}),
      ...(upper ? { createdAt: { ...(fromDay ? { gte: fromDay } : {}), lt: upper } } : {}),
      ...(bookTitle ? { book: { title: String(bookTitle).trim() } } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 20,
    include: { book: { select: { title: true } } },
  })
  return notes.map((note) => ({ ...serializeNote(note), book: note.book?.title ?? '' }))
}

export async function deleteNote(userId, noteId) {
  const note = await findOwned('readingNote', noteId, userId, '笔记')
  await prisma.readingNote.delete({ where: { id: note.id } })
  logger.info('删除笔记', { userId })
}

/**
 * 聊天工具用：按书名精确匹配书架，没有则自动上架（在读），可顺带记页码/感想。
 * 只报页码不写感想时只推进度——不要走 addNote，它强制要求正文。
 */
export async function logReading(userId, { title, page, note }) {
  if (typeof title !== 'string' || !title.trim()) throw new HttpError('书名不能为空', 400)
  const safeTitle = title.trim()
  let book = await prisma.book.findFirst({
    where: { userId, title: safeTitle },
    orderBy: { updatedAt: 'desc' },
  })
  if (!book) book = await addBook(userId, { title: safeTitle })
  if (note !== undefined) {
    const { book: updated } = await addNote(userId, book.id, { content: note, page })
    book = updated
  } else if (page !== undefined) {
    if (!Number.isInteger(page) || page < 1) throw new HttpError('页码必须是正整数', 400)
    book = await updateBook(userId, book.id, {
      currentPage: page,
      ...(book.status === 'want' ? { status: 'reading' } : {}),
    })
  }
  return { bookId: book.id, title: book.title, currentPage: book.currentPage }
}
