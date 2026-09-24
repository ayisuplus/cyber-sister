import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Trash2 } from 'lucide-react'
import Header from '../components/layout/Header'
import Card from '../components/ui/Card'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import EmptyState from '../components/ui/EmptyState'
import BuiltinShelf from '../components/reading/BuiltinShelf'
import ShareBookDialog from '../components/reading/ShareBookDialog'
import { readingService } from '../services/readingService'
import { bookStore } from '../services/bookStore'
import { readEpub } from '../lib/epub'
import { readPlainText } from '../lib/plaintext'

// 书架（路线图 C22）：上面是 Amie 的藏书（她按书改编的章节，只读），下面是你放进来的书。
// 你的书默认只放在这台设备的浏览器里，服务器只记书目、进度和笔记；
// 你选了「让她聊天时也能翻」的书，才把解析好的章节传上去，聊天时和藏书一起翻，随时可以撤回。
const STATUS_LABEL = { want: '想读', reading: '在读', finished: '读完' }
const POLL_MS = 3000

const formatOf = (name) => {
  const lower = name.toLowerCase()
  if (lower.endsWith('.epub')) return 'epub'
  if (lower.endsWith('.txt')) return 'txt'
  return null
}

const readableError = (error, fallback) =>
  error?.name === 'EpubError' || error?.name === 'BookStoreError' ? error.message : fallback

// 上传被拒时照实说原因：书还在这台设备上
const SHARE_REFUSED = {
  CLOUD_NOT_CONSENTED: '要先在设置里同意云端处理，她才能翻这本书；书先只放在这台设备上',
  EMBEDDING_UNAVAILABLE: '这台服务器还没配向量模型，书先只放在这台设备上',
}
const shareError = (error) => SHARE_REFUSED[error?.response?.data?.code]
  ?? (error?.response?.status === 413 ? error.response.data?.error : null)
  ?? '没传上去，书先只放在这台设备上，稍后可以再试'

/** 这本书有没有传给 Amie：一行小字 + 能做的那一件事 */
function shareState(book) {
  if (book.serverIndex === 'indexing') {
    const progress = book.indexProgress ? ` ${book.indexProgress.done}/${book.indexProgress.total}` : ''
    return { label: `正在整理…${progress}`, action: 'unshare' }
  }
  if (book.serverIndex === 'ready') return { label: '聊天时她也能翻', action: 'unshare' }
  if (book.serverIndex === 'failed') return { label: '没整理成', action: 'share', actionLabel: '重试' }
  return { label: '只在你的设备上', action: 'share', actionLabel: '让她也能翻' }
}

function ShareLine({ book, local, busy, onShare, onUnshare }) {
  const state = shareState(book)
  const canShare = state.action === 'share' && local
  return (
    <div className="mt-2 flex items-center gap-2 text-xs">
      <span className={book.serverIndex === 'failed' ? 'text-danger' : 'text-text-muted'}>{state.label}</span>
      {canShare && (
        <button type="button" disabled={busy} onClick={() => onShare(book)} className="min-h-11 text-action-primary underline disabled:opacity-50">
          {state.actionLabel}
        </button>
      )}
      {state.action === 'unshare' && (
        <button type="button" disabled={busy} onClick={() => onUnshare(book)} className="min-h-11 text-text-secondary underline disabled:opacity-50">
          只留在设备上
        </button>
      )}
    </div>
  )
}

export default function ReadingPage() {
  const navigate = useNavigate()
  const sequence = useRef(0)
  const fileInput = useRef(null)
  const [books, setBooks] = useState([])
  const [shelf, setShelf] = useState([])
  const [localIds, setLocalIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tip, setTip] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)
  const [pendingShare, setPendingShare] = useState(null)
  const [sharing, setSharing] = useState(false)

  const load = useCallback(async ({ quiet = false } = {}) => {
    const request = ++sequence.current
    if (!quiet) { setLoading(true); setLoadError('') }
    try {
      const mine = await readingService.listBooks()
      const ids = await bookStore.listIds().catch(() => new Set())
      if (request !== sequence.current) return
      setBooks(mine)
      setLocalIds(ids)
    } catch {
      if (request === sequence.current && !quiet) setLoadError('书架没打开，请检查网络后重试')
    } finally {
      if (request === sequence.current && !quiet) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // 藏书取不到就不摆那一格，不挡着你的书
  useEffect(() => {
    let alive = true
    readingService.listShelf().then((list) => { if (alive) setShelf(Array.isArray(list) ? list : []) }).catch(() => {})
    return () => { alive = false }
  }, [])

  // 有书正在整理时隔几秒看一眼进度
  const indexing = books.some((book) => book.serverIndex === 'indexing')
  useEffect(() => {
    if (!indexing) return undefined
    const timer = setTimeout(() => load({ quiet: true }), POLL_MS)
    return () => clearTimeout(timer)
  }, [indexing, books, load])

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
      setPendingShare({ id: book.id, title, chapters: parsed.chapters })
    } catch (importError) {
      setError(readableError(importError, '没放进去，再试一次'))
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  // 从书架上点「让她也能翻」：章节从这台设备上取，再问一次
  const askShare = async (book) => {
    setError(''); setTip('')
    try {
      const stored = await bookStore.getBook(book.id)
      if (!stored?.chapters?.length) throw new Error('missing')
      setPendingShare({ id: book.id, title: book.title, chapters: stored.chapters })
    } catch {
      setError(`《${book.title}》的文件不在这台设备上，重新放一次再试`)
    }
  }

  const share = async () => {
    const target = pendingShare
    if (!target) return
    setSharing(true)
    try {
      await readingService.shareBook(target.id, target.chapters)
      setTip(`正在整理《${target.title}》，整理好她聊天时就能翻了`)
    } catch (shareFailure) {
      setError(shareError(shareFailure))
    } finally {
      setSharing(false)
      setPendingShare(null)
      await load({ quiet: true })
    }
  }

  const unshare = async (book) => {
    setError(''); setTip('')
    try {
      await readingService.unshareBook(book.id)
      setTip(`《${book.title}》只留在你的设备上了，服务器上的段落已删掉`)
    } catch {
      setError('没撤回，请重试')
    }
    await load({ quiet: true })
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
      <Header title="书架" showBack />
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

        <BuiltinShelf books={shelf} />

        <section aria-labelledby="shelf-mine" className="space-y-2">
          <h2 id="shelf-mine" className="px-1 text-sm font-semibold text-text-primary">我的书</h2>
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
              支持 EPUB 和 TXT。书默认只存在这台设备上，读的时候选中一段问她，才会把那一段发过去；
              也可以让她聊天时翻这本书，那样书会存到服务器，找到的段落会随聊天发给云端模型，随时可以撤回。
            </p>
            <p aria-live="polite" className="min-h-5 text-xs text-text-secondary">
              {error ? <span role="alert" className="text-danger">{error}</span> : tip}
            </p>
          </Card>

          {loadError && (
            <p role="alert" className="text-sm text-danger">
              {loadError}
              <button type="button" className="ml-2 min-h-11 underline" onClick={() => load()}>重试</button>
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
                    <Card className="flex items-start gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <button type="button" onClick={() => open(book)} className="block w-full min-w-0 text-left">
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
                        {book.format && (
                          <ShareLine book={book} local={localIds.has(book.id)} busy={sharing} onShare={askShare} onUnshare={unshare} />
                        )}
                      </div>
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
        </section>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="把这本书从书架上拿走"
        description="书、进度和这本书下的笔记都会删掉，传给 Amie 的段落也一起删掉，找不回来了。"
        confirmLabel="确认删除" danger onConfirm={remove} onCancel={() => setPendingDelete(null)}
      />
      <ShareBookDialog book={pendingShare} busy={sharing} onShare={share} onKeepLocal={() => setPendingShare(null)} />
    </div>
  )
}
