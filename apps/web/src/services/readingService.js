import api from './api'

// 书架与读书笔记。书本身存在这台设备的浏览器里（见 bookStore.js），
// 服务端只知道你在读什么、读到哪儿、记了什么。
export const readingService = {
  listBooks: async () => (await api.get('/reading/books')).data,
  addBook: async (book) => (await api.post('/reading/books', book)).data,
  updateBook: async (bookId, changes) => (await api.put(`/reading/books/${bookId}`, changes)).data,
  deleteBook: async (bookId) => (await api.delete(`/reading/books/${bookId}`)).data,
  saveProgress: async (bookId, { locator, percent }) =>
    (await api.put(`/reading/books/${bookId}/progress`, { locator, percent })).data,

  listNotes: async (bookId) => (await api.get(`/reading/books/${bookId}/notes`)).data,
  addNote: async (bookId, note) => (await api.post(`/reading/books/${bookId}/notes`, note)).data,

  // 按日历日区间跨书取笔记（from/to 为 'yyyy-MM-dd'，含当天；日历「那天的记录」、聊天查某天用）。
  // 与上面的 listNotes(bookId) 不同：那是「某一本书下的全部笔记」，这里不挑书、按记下的时间过滤。
  listNotesBetween: async ({ from, to } = /** @type {{ from?: string, to?: string }} */ ({})) =>
    (await api.get('/reading/notes', { params: { from, to } })).data.notes,

  // 手记时间线用：看最近记了什么、按书名记一笔、删掉一条
  listRecentNotes: async (params) => (await api.get('/reading/notes', params ? { params } : undefined)).data.notes,
  logNote: async ({ book, note, page = undefined }) => (await api.post('/reading/notes', { book, note, page })).data,
  deleteNote: async (noteId) => (await api.delete(`/reading/notes/${noteId}`)).data,
}
