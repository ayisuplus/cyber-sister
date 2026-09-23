import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Trash2 } from 'lucide-react'
import Header from '../components/layout/Header'
import Card from '../components/ui/Card'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import EmptyState from '../components/ui/EmptyState'
import { readingService } from '../services/readingService'
import { bookStore } from '../services/bookStore'
import { readEpub } from '../lib/epub'
import { readPlainText } from '../lib/plaintext'

// 书架：书放在这台设备的浏览器里，服务器只记书目、进度和笔记。
// 换一台设备，书架还在，重新放一次文件就能接着读。
const STATUS_LABEL = { want: '想读', reading: '在读', finished: '读完' }

const formatOf = (name) => {
  const lower = name.toLowerCase()
  if (lower.endsWith('.epub')) return 'epub'
  if (lower.endsWith('.txt')) return 'txt'
  return null
}

const readableError = (error, fallback) =>
  error?.name === 'EpubError' || error?.name === 'BookStoreError' ? error.message : fallback

export default function ReadingPage() {
  const navigate = useNavigate()
  const sequence = useRef(0)
  const fileInput = useRef(null)
  const [books, setBooks] = useState([])
  const [localIds, setLocalIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tip, setTip] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)

  const load = useCallback(async () => {
    const request = ++sequence.current
    setLoading(true)
    setLoadError('')
    try {
      const shelf = await readingService.listBooks()
      const ids = await bookStore.listIds().catch(() => new Set())
      if (request !== sequence.current) return
      setBooks(shelf)
      setLocalIds(ids)
    } catch {
      if (request === sequence.current) setLoadError('书架没打开，请检查网络后重试')
    } finally {
      if (request === sequence.current) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const importFile = async (file) => {
    if (!file || busy) return
    setBusy(true); setError(''); setTip('')
    try {
      const format = formatOf(file.name)
      if (!format) throw Object.assign(new Error('先放 EPUB 或 TXT，PDF 暂时读不了'), { name: 'EpubError' })

      const room = await bookStore.estimate()
      if (room && room.quota - room.usage < file.size * 2) {
        throw Object.assign(new Error('这台设备的存储空间不够了，先删掉一本再放'), { name: 'BookStoreError' })
      }

      const buffer = await file.arrayBuffer()
      const parsed = format === 'epub' ? await readEpub(buffer) : readPlainText(buffer)
      const title = (parsed.title || file.name.replace(/\.(epub|txt)$/i, '')).trim().slice(0, 100)

      const book = await readingService.addBook({
        title,
        ...(parsed.author ? { author: parsed.author.slice(0, 50) } : {}),
        format,
        fileName: file.name.slice(0, 200),
      })
      try {
        await bookStore.putBook(book.id, { fileName: file.name, format, chapters: parsed.chapters })
      } catch (storeError) {
        // 文件没存下来就不要在书架上留一本打不开的书
        await readingService.deleteBook(book.id).catch(() => {})
        throw storeError
      }
      setTip(`《${title}》放好了`)
      await load()
    } catch (importError) {
      setError(readableError(importError, '没放进去，再试一次'))
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const remove = async () => {
    const target = pendingDelete
    setPendingDelete(null)
    if (!target) return
    try {
      await readingService.deleteBook(target.id)
      await bookStore.deleteBook(target.id).catch(() => {})
      await load()
    } catch {
      setError('没删掉，请重试')
    }
  }

  const open = (book) => {
    if (!localIds.has(book.id)) {
      setError(`《${book.title}》的文件不在这台设备上，重新放一次就能接着读`)
      return
    }
    navigate(`/tools/reading/${book.id}`)
  }

  // 在读、且文件确实在这台设备上的第一本——书架本来就按最近更新排
  const resume = books.find((item) => item.status === 'reading' && localIds.has(item.id))

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
      <Header title="读书" showBack />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {resume && (
          <Card className="p-0">
            <button type="button" onClick={() => navigate(`/tools/reading/${resume.id}`)} className="w-full rounded-card p-4 text-left">
              <span className="block text-xs text-text-muted">接着读</span>
              <span className="mt-1 block truncate text-sm font-semibold text-text-primary">{resume.title}</span>
              {resume.percent != null && <span className="mt-1 block text-xs text-text-muted">读到 {resume.percent}%</span>}
            </button>
          </Card>
        )}

        <Card className="space-y-2 p-4">
          <input
            ref={fileInput} type="file" accept=".epub,.txt" aria-label="选一本书"
            onChange={(event) => importFile(event.target.files?.[0])}
            className="sr-only"
          />
          <button
            type="button" disabled={busy} onClick={() => fileInput.current?.click()}
            className="min-h-11 w-full rounded-xl bg-action-primary px-5 text-sm font-semibold text-text-inverse disabled:opacity-50"
          >
            {busy ? '正在读这本书…' : '放一本书进来'}
          </button>
          <p className="text-xs leading-relaxed text-text-muted">
            支持 EPUB 和 TXT。书只存在这台设备上，不会上传；问她的时候才会把你选中的那一段发过去。
          </p>
          <p aria-live="polite" className="min-h-5 text-xs text-text-secondary">
            {error ? <span role="alert" className="text-danger">{error}</span> : tip}
          </p>
        </Card>

        {loadError && (
          <p role="alert" className="text-sm text-danger">
            {loadError}
            <button type="button" className="ml-2 min-h-11 underline" onClick={load}>重试</button>
          </p>
        )}

        {loading && books.length === 0 ? <p role="status" className="py-8 text-center text-sm text-text-muted">加载中…</p>
          : books.length === 0 ? (
            <div className="rounded-card bg-surface-card shadow-card">
              <EmptyState icon={BookOpen} title="书架还空着" description="放一本书进来，就可以和她一起读了。" />
            </div>
          ) : (
            <ul className="space-y-2">
              {books.map((book) => (
                <li key={book.id}>
                  <Card className="flex items-center gap-3 p-4">
                    <button type="button" onClick={() => open(book)} className="min-w-0 flex-1 text-left">
                      <p className="truncate text-sm font-semibold text-text-primary">{book.title}</p>
                      <p className="mt-1 truncate text-xs text-text-muted">
                        {[
                          book.author,
                          STATUS_LABEL[book.status],
                          book.percent != null ? `读到 ${book.percent}%` : null,
                          book.noteCount ? `${book.noteCount} 条笔记` : null,
                          localIds.has(book.id) ? null : '文件不在这台设备上',
                        ].filter(Boolean).join(' · ')}
                      </p>
                    </button>
                    <button
                      type="button" aria-label={`删除《${book.title}》`}
                      onClick={() => setPendingDelete(book)}
                      className="flex h-11 w-11 shrink-0 items-center justify-center text-text-muted hover:text-danger"
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </Card>
                </li>
              ))}
            </ul>
          )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="把这本书从书架上拿走"
        description="书、进度和这本书下的笔记都会删掉，找不回来了。"
        confirmLabel="确认删除" danger onConfirm={remove} onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
