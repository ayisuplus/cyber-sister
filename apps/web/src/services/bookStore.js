// 书存在这台设备的浏览器里，不上传服务器。这里只做存取，解析在 lib/epub.js 与 lib/plaintext.js。
// 只保留解析好的章节文本，不留原始文件：读的时候用不上，留着白占一倍空间。

const DB_NAME = 'amie-books'
const DB_VERSION = 1
const STORE = 'books'

class BookStoreError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BookStoreError'
  }
}

const openDb = () => new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined') {
    reject(new BookStoreError('这个浏览器不支持把书存在本地'))
    return
  }
  const request = indexedDB.open(DB_NAME, DB_VERSION)
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE)) {
      request.result.createObjectStore(STORE, { keyPath: 'id' })
    }
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(new BookStoreError('打不开本地书库'))
  request.onblocked = () => reject(new BookStoreError('本地书库正被另一个标签页占用，关掉它再试'))
})

const run = async (mode, work) => {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode)
      const request = work(transaction.objectStore(STORE))
      transaction.onabort = () => reject(
        transaction.error?.name === 'QuotaExceededError'
          ? new BookStoreError('这台设备的存储空间不够了，先删掉一本再放')
          : new BookStoreError('本地书库写不进去')
      )
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(new BookStoreError('本地书库读写失败'))
    })
  } finally {
    db.close()
  }
}

export const bookStore = {
  /** 存一本解析好的书；id 用服务端书架里的书 id。 */
  putBook: (id, { fileName, format, chapters }) =>
    run('readwrite', (store) => store.put({ id, fileName, format, chapters, savedAt: Date.now() })),

  getBook: (id) => run('readonly', (store) => store.get(id)),

  deleteBook: (id) => run('readwrite', (store) => store.delete(id)),

  /** 书架上哪几本在这台设备上真的有文件。 */
  listIds: async () => {
    const keys = await run('readonly', (store) => store.getAllKeys())
    return new Set(keys)
  },

  /** 放书之前先看看还剩多少空间；浏览器不给就返回 null。 */
  estimate: async () => {
    try {
      const { usage, quota } = await navigator.storage.estimate()
      return typeof quota === 'number' ? { usage: usage ?? 0, quota } : null
    } catch {
      return null
    }
  },
}

export { BookStoreError }
