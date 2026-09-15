import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Sparkles, Trash2 } from 'lucide-react'
import Header from '../components/layout/Header'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import EmptyState from '../components/ui/EmptyState'
import SourceBadge from '../components/ui/SourceBadge'
import Spinner from '../components/ui/Spinner'
import { readingService } from '../services/readingService'

const STATUS_GROUPS = [
  { value: 'reading', label: '在读' },
  { value: 'want', label: '想读' },
  { value: 'finished', label: '读完' },
]
const inputClass = 'w-full rounded-2xl bg-surface-input p-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-status-info'

function NoteItem({ note, onComment, onDelete }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)

  const handleComment = async () => {
    if (loading) return
    setLoading(true); setError('')
    try {
      const result = await onComment(note.id)
      if (result.source === 'cloud_mock') setPreview(result)
    } catch (requestError) {
      const code = requestError?.response?.data?.code
      setError(code === 'CLOUD_NOT_CONSENTED' ? 'not_consented' : 'unavailable')
    } finally {
      setLoading(false)
    }
  }

  return (
    <li className="rounded-2xl bg-surface-muted p-3">
      <div className="flex items-start gap-2">
        {note.page != null && (
          <span className="mt-0.5 inline-flex shrink-0 rounded-full bg-pastel-apricot px-2 py-0.5 text-[10px] font-medium text-text-secondary">第 {note.page} 页</span>
        )}
        <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">{note.content}</p>
        <button type="button" aria-label={`删除笔记 ${note.content.slice(0, 16)}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-text-muted hover:text-danger" onClick={() => onDelete(note)}><Trash2 size={16} /></button>
      </div>
      <div className="mt-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex rounded-full bg-pastel-mist px-2 py-0.5 text-[10px] font-medium text-status-info">AI</span>
          <span className="text-xs font-semibold text-text-primary">姐妹的回应</span>
        </div>
        {note.aiComment || preview ? (
          <div className="mt-2">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">{preview?.aiComment || note.aiComment}</p>
            <div className="mt-1">
              <SourceBadge source={preview?.source || note.aiCommentSource} />
            </div>
            {preview && <p className="mt-2 text-xs text-text-muted">这是模拟回应，未连接云端，也未保存到笔记。</p>}
          </div>
        ) : (
          <div className="mt-2">
            <Button variant="secondary" className="w-full" disabled={loading} onClick={handleComment}>
              {loading ? <Spinner /> : <Sparkles size={16} />}
              让姐妹看看
            </Button>
            {error === 'not_consented' && (
              <p role="alert" className="mt-2 text-xs text-danger">
                还没有同意使用云端模型，去<Link to="/settings" className="underline">「设置 → 聊天模型」</Link>开启后再让她看看吧
              </p>
            )}
            {error === 'unavailable' && (
              <p role="alert" className="mt-2 text-xs text-danger">姐妹现在有点忙，稍后再让她看看吧</p>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

function BookCard({ book, onUpdated, onDeleted }) {
  const [notes, setNotes] = useState([])
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [pageText, setPageText] = useState('')
  const [noteText, setNoteText] = useState('')
  const [saving, setSaving] = useState(false)
  const [noteError, setNoteError] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [noteToDelete, setNoteToDelete] = useState(null)
  const [actionError, setActionError] = useState('')
  const [notesError, setNotesError] = useState('')
  const [notesReload, setNotesReload] = useState(0)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    let cancelled = false
    setNotesError('')
    readingService.listNotes(book.id)
      .then(list => { if (!cancelled) setNotes(list) })
      .catch(() => { if (!cancelled) setNotesError('笔记加载失败，请重试') })
    return () => { cancelled = true }
  }, [book.id, notesReload])

  const progress = book.totalPages ? Math.min(100, Math.round((book.currentPage / book.totalPages) * 100)) : null

  const handleStatus = async (status) => {
    if (status === book.status || updating) return
    setUpdating(true); setActionError('')
    try {
      const updated = await readingService.updateBook(book.id, { status })
      onUpdated(updated)
    } catch { setActionError('阅读状态更新失败，请重试') }
    finally { setUpdating(false) }
  }

  const handleAddNote = async () => {
    if (!noteText.trim() || saving) return
    setSaving(true); setNoteError('')
    try {
      const page = pageText.trim() ? Number(pageText) : undefined
      const result = await readingService.addNote(book.id, { content: noteText.trim(), page })
      setNotes(prev => [result.note, ...prev])
      onUpdated(result.book)
      setNoteText(''); setPageText(''); setShowNoteForm(false)
    } catch (requestError) {
      setNoteError(requestError?.response?.data?.error || '保存失败，请稍后再试')
    } finally {
      setSaving(false)
    }
  }

  const handleComment = async (noteId) => {
    const result = await readingService.requestNoteComment(noteId)
    if (result.source !== 'cloud_mock') setNotes(prev => prev.map(n => (n.id === noteId ? { ...n, aiComment: result.aiComment, aiCommentSource: result.source } : n)))
    return result
  }

  const handleDeleteNote = async () => {
    const target = noteToDelete
    setNoteToDelete(null); setActionError('')
    if (!target) return
    try {
      await readingService.deleteNote(target.id)
      setNotes(prev => prev.filter(item => item.id !== target.id))
    } catch { setActionError('删除笔记失败，请重试') }
  }

  const handleDelete = async () => {
    setShowDeleteConfirm(false)
    setActionError('')
    try {
      await readingService.deleteBook(book.id)
      onDeleted(book.id)
    } catch { setActionError('删除书籍失败，请重试') }
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-text-primary">《{book.title}》</h3>
          {book.author && <p className="mt-0.5 text-xs text-text-muted">{book.author}</p>}
        </div>
        <button
          type="button"
          aria-label={`删除《${book.title}》`}
          onClick={() => setShowDeleteConfirm(true)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-text-muted hover:text-danger"
        >
          <Trash2 size={18} />
        </button>
      </div>

      {book.totalPages ? (
        <div className="mt-2">
          <div className="h-2 w-full rounded-full bg-surface-muted">
            <div className="h-2 rounded-full bg-action-primary" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-xs text-text-muted tabular-nums">读到 {book.currentPage}/{book.totalPages} 页</p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-text-muted">已读 {book.currentPage} 页</p>
      )}

      <div className="mt-2 flex gap-2" role="group" aria-label="阅读状态">
        {STATUS_GROUPS.map(group => (
          <button
            key={group.value}
            type="button"
            aria-pressed={book.status === group.value}
            disabled={updating}
            onClick={() => handleStatus(group.value)}
            className={`min-h-11 flex-1 rounded-xl text-xs ${book.status === group.value ? 'bg-pastel-blush font-semibold text-action-primary' : 'bg-surface-muted text-text-muted'}`}
          >
            {group.label}
          </button>
        ))}
      </div>

      {actionError && <p role="alert" className="mt-2 text-xs text-danger">{actionError}</p>}
      {notesError && <div className="mt-2"><p role="alert" className="text-xs text-danger">{notesError}</p><Button variant="secondary" onClick={() => setNotesReload(value => value + 1)}>重试笔记</Button></div>}
      <div className="mt-3">
        <Button variant="secondary" className="w-full" onClick={() => setShowNoteForm(v => !v)}>
          {showNoteForm ? '收起' : '记一笔'}
        </Button>
        {showNoteForm && (
          <div className="mt-2 space-y-2">
            <input
              aria-label="页码"
              inputMode="numeric"
              value={pageText}
              onChange={event => setPageText(event.target.value)}
              placeholder="读到第几页"
              className={inputClass}
            />
            <textarea
              aria-label="感想"
              value={noteText}
              maxLength={500}
              onChange={event => setNoteText(event.target.value)}
              placeholder="这句话、这个情节……此刻的想法"
              className={`${inputClass} h-20 resize-none`}
            />
            {noteError && <p role="alert" className="text-xs text-danger">{noteError}</p>}
            <Button variant="primary" className="w-full" disabled={!noteText.trim() || saving} onClick={handleAddNote}>
              {saving ? <Spinner onDark /> : null}
              记下来
            </Button>
          </div>
        )}
      </div>

      {notes.length > 0 && (
        <ul className="mt-3 space-y-2">
          {notes.map(note => (
            <NoteItem key={note.id} note={note} onComment={handleComment} onDelete={setNoteToDelete} />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={noteToDelete !== null}
        title="删除这条笔记"
        description="这条感想及其已保存的回应会一起删除，确定继续吗？"
        confirmLabel="删除笔记"
        danger
        onConfirm={handleDeleteNote}
        onCancel={() => setNoteToDelete(null)}
      />
      <ConfirmDialog
        open={showDeleteConfirm}
        title={`删除《${book.title}》`}
        description="这本书和它的感想笔记都会删掉，确定继续吗？"
        confirmLabel="确认删除"
        danger
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </Card>
  )
}

// embedded：作为「手记」页签嵌入时不渲染自己的页头
export default function ReadingPage({ embedded = false } = {}) {
  const [books, setBooks] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [totalPagesText, setTotalPagesText] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true); setLoadError('')
    readingService.listBooks()
      .then(list => { if (!cancelled) setBooks(list) })
      .catch(() => { if (!cancelled) setLoadError('书架加载失败，请稍后再试') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reloadTick])

  const handleAddBook = async () => {
    if (!title.trim() || adding) return
    setAdding(true); setAddError('')
    try {
      const totalPages = totalPagesText.trim() ? Number(totalPagesText) : undefined
      await readingService.addBook({ title: title.trim(), author: author.trim() || undefined, totalPages })
      setTitle(''); setAuthor(''); setTotalPagesText('')
      setReloadTick(tick => tick + 1)
    } catch (requestError) {
      setAddError(requestError?.response?.data?.error || '保存失败，请稍后再试')
    } finally {
      setAdding(false)
    }
  }

  const handleUpdated = useCallback((updated) => {
    setBooks(prev => prev.map(b => (b.id === updated.id ? { ...b, ...updated } : b)))
  }, [])
  const handleDeleted = useCallback((id) => {
    setBooks(prev => prev.filter(b => b.id !== id))
  }, [])

  return (
    <div className="flex-1 flex flex-col bg-transparent overflow-hidden">
      {!embedded && <Header title="一起读书" showBack />}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-text-primary">放一本新书</h2>
          <div className="mt-3 space-y-2">
            <input
              aria-label="书名"
              value={title}
              maxLength={100}
              onChange={event => setTitle(event.target.value)}
              placeholder="书名（必填）"
              className={inputClass}
            />
            <input
              aria-label="作者"
              value={author}
              maxLength={50}
              onChange={event => setAuthor(event.target.value)}
              placeholder="作者（可空）"
              className={inputClass}
            />
            <input
              aria-label="总页数"
              inputMode="numeric"
              value={totalPagesText}
              onChange={event => setTotalPagesText(event.target.value)}
              placeholder="总页数（可空）"
              className={inputClass}
            />
          </div>
          {addError && <p role="alert" className="mt-2 text-xs text-danger">{addError}</p>}
          <Button variant="primary" className="mt-2 w-full" disabled={!title.trim() || adding} onClick={handleAddBook}>
            {adding ? <Spinner onDark /> : null}
            放上书架
          </Button>
        </Card>

        {loading ? (
          <p role="status" className="py-8 text-center text-sm text-text-muted">加载中…</p>
        ) : loadError ? (
          <div className="py-8 text-center">
            <p role="alert" className="text-sm text-danger">{loadError}</p>
            <Button variant="secondary" className="mt-3" onClick={() => setReloadTick(tick => tick + 1)}>重试</Button>
          </div>
        ) : books.length === 0 ? (
          <EmptyState icon={BookOpen} title="书架还空着" description="先加一本想读的书吧" />
        ) : (
          STATUS_GROUPS.map(group => {
            const groupBooks = books.filter(b => b.status === group.value)
            if (groupBooks.length === 0) return null
            return (
              <section key={group.value}>
                <h2 className="px-1 text-xs font-semibold text-text-muted">{group.label}（{groupBooks.length}）</h2>
                <div className="mt-2 space-y-3">
                  {groupBooks.map(book => (
                    <BookCard key={book.id} book={book} onUpdated={handleUpdated} onDeleted={handleDeleted} />
                  ))}
                </div>
              </section>
            )
          })
        )}
      </div>

    </div>
  )
}
