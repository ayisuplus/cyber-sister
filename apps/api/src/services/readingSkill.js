/**
 * 「读书」操作技能：书架、阅读进度与读书笔记。
 * 读书笔记只能删了重记（页面同语义），不提供「改笔记」工具。
 */
import { skillSection } from './skillCatalog.js'
import { logReading, listBooks, listNotesBetween, updateBook, deleteNote } from './readingService.js'
import { HttpError } from '../utils/dbHelpers.js'
import { nativeObject, nativeString } from '../utils/toolSchema.js'

const core = skillSection('reading', '核心行为')

const MAX_SUMMARY_LENGTH = 60
const clip = (text, max = MAX_SUMMARY_LENGTH) => {
  const value = String(text ?? '')
  return value.length > max ? `${value.slice(0, max)}…` : value
}

export const READING_SKILL = {
  id: 'reading',
  title: '读书',
  tools: {
    log_reading: {
      description: '{"tool":"log_reading","args":{"book":"书名","page":"可选 读到第几页（从1起）","note":"可选 一句话感想"}} 记录阅读进度或感想，两者可只给其一；书不在书架会自动放入（在读）',
      run: async (userId, args) => {
        const result = await logReading(userId, { title: args.book, page: args.page, note: args.note })
        return { summary: `已记下《${clip(result.title, 12)}》的阅读`, result: { bookId: result.bookId, title: result.title, currentPage: result.currentPage } }
      },
    },
    list_books: {
      description: '{"tool":"list_books","args":{"status":"可选 want|reading|finished|all"}} 看书架：每本的状态、进度与笔记数（只读）',
      run: async (userId, args) => {
        const books = await listBooks(userId)
        const items = (args.status && args.status !== 'all' ? books.filter((book) => book.status === args.status) : books)
          .map(({ id, title, author, status, currentPage, totalPages, percent, noteCount }) => ({ id, title, author, status, currentPage, totalPages, percent, noteCount }))
        return { summary: `书架上有 ${items.length} 本`, result: { items } }
      },
    },
    list_reading_notes: {
      description: '{"tool":"list_reading_notes","args":{"book":"可选 书名精确匹配","from":"可选 yyyy-MM-dd","to":"可选 yyyy-MM-dd，含当天"}} 查读书笔记（只读）；都缺省取最近 20 条',
      run: async (userId, args) => {
        const notes = await listNotesBetween(userId, { from: args.from, to: args.to, bookTitle: args.book })
        return { summary: `找到 ${notes.length} 条读书笔记`, result: { items: notes } }
      },
    },
    update_book: {
      description: '{"tool":"update_book","args":{"id":"书的 id","status":"可选 want|reading|finished","currentPage":"可选 读到第几页"}} 改一本书的状态或进度',
      run: async (userId, args) => {
        const changes = {}
        if (args.status !== undefined) changes.status = args.status
        if (args.currentPage !== undefined) changes.currentPage = args.currentPage
        if (Object.keys(changes).length === 0) throw new HttpError('需要 status 或 currentPage 至少一项', 400)
        const book = await updateBook(userId, String(args.id || ''), changes)
        return { summary: `已更新《${clip(book.title, 12)}》`, result: { id: book.id, status: book.status, currentPage: book.currentPage } }
      },
    },
    delete_reading_note: {
      needsConfirm: () => '删掉这条读书笔记',
      description: '{"tool":"delete_reading_note","args":{"id":"笔记 id"}} 删除一条读书笔记（需要用户确认；笔记只能删了重记，没有改笔记）',
      run: async (userId, args) => {
        await deleteNote(userId, String(args.id || ''))
        return { summary: '已删掉这条读书笔记', result: { id: String(args.id || '') } }
      },
    },
  },
  toolParameters: {
    log_reading: nativeObject({ book: nativeString, page: { type: 'integer', minimum: 1 }, note: nativeString }, ['book']),
    list_books: nativeObject({ status: { type: 'string', enum: ['want', 'reading', 'finished', 'all'] } }),
    list_reading_notes: nativeObject({ book: nativeString, from: nativeString, to: nativeString }),
    update_book: nativeObject({ id: nativeString, status: { type: 'string', enum: ['want', 'reading', 'finished'] }, currentPage: { type: 'integer', minimum: 0 } }, ['id']),
    delete_reading_note: nativeObject({ id: nativeString }, ['id']),
  },
  buildContext(text, _history = [], scene = 'chat') {
    if (scene !== 'chat' || typeof text !== 'string') return []
    if (!/读书|书架|读后感|阅读进度|这本书/.test(text)) return []
    return [{ role: 'system', content: `[Amie 内置技能：读书 v1]\n${core}` }]
  },
}
