import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, subMonths } from 'date-fns'
import { BookOpen, CloudFog, CloudRain, Flame, Laugh, Leaf, NotebookPen, Trash2 } from 'lucide-react'
import Header from '../components/layout/Header'
import Card from '../components/ui/Card'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import EmptyState from '../components/ui/EmptyState'
import { diaryService } from '../services/diaryService'
import { readingService } from '../services/readingService'

// 手记：你写下的一切排成一条时间线——当天的日记，和读书时记的一笔。
// 日记一天一篇（再写就是改今天那篇）；读书笔记从书架里选一本记到它下面，书架上没有的（纸书）才手写书名。
const MOODS = [
  { value: 'happy', label: '开心', icon: Laugh },
  { value: 'neutral', label: '平静', icon: Leaf },
  { value: 'sad', label: '难过', icon: CloudRain },
  { value: 'angry', label: '生气', icon: Flame },
  { value: 'anxious', label: '焦虑', icon: CloudFog },
]
const moodOf = (value) => MOODS.find((mood) => mood.value === value)
const NOTE_PAGE_SIZE = 20
const NOTE_MAX = 500 // 与服务端 readingService 的上限一致，不要让人写完才被拒
const DIARY_MAX = 2000
const today = () => format(new Date(), 'yyyy-MM-dd')
const dayLabel = (day) => format(new Date(`${day}T00:00:00`), 'M月d日')
const chipClass = (on) => `flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors duration-300 ease-calm ${on ? 'border-action-primary bg-pastel-blush text-action-primary' : 'border-border-subtle text-text-secondary'}`

export default function NotesPage() {
  const sequence = useRef(0)
  const [entries, setEntries] = useState([])
  const [notes, setNotes] = useState([])
  const [monthsBack, setMonthsBack] = useState(0)
  const [hasOlder, setHasOlder] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [draft, setDraft] = useState('')
  const [mood, setMood] = useState('neutral')
  const [book, setBook] = useState('')
  const [asBook, setAsBook] = useState(false)
  const [shelf, setShelf] = useState(null) // null = 还没取过书架
  const [pickedBookId, setPickedBookId] = useState(null) // null = 不在书架上，手写书名
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [savedTip, setSavedTip] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)

  const load = useCallback(async (months) => {
    const request = ++sequence.current
    setLoading(true)
    setLoadError('')
    try {
      const [monthEntries, recent] = await Promise.all([
        Promise.all(Array.from({ length: months + 1 }, (_, index) => diaryService.listMonth(format(subMonths(new Date(), index), 'yyyy-MM')))),
        readingService.listRecentNotes({ limit: NOTE_PAGE_SIZE * (months + 1) }),
      ])
      if (request !== sequence.current) return
      const merged = new Map()
      for (const entry of monthEntries.flat()) merged.set(entry.day, entry)
      setEntries([...merged.values()])
      setNotes(recent)
      setHasOlder(recent.length >= NOTE_PAGE_SIZE * (months + 1) || months < 2)
    } catch {
      if (request === sequence.current) setLoadError('加载失败，请检查网络后重试')
    } finally {
      if (request === sequence.current) setLoading(false)
    }
  }, [])

  useEffect(() => { load(monthsBack) }, [load, monthsBack])

  const todayEntry = entries.find((entry) => entry.day === today())

  // 书架按最近更新排，第一本就是你在读的那本；prefer 指定时优先停在那一本上
  const refreshShelf = async (prefer) => {
    try {
      const books = await readingService.listBooks()
      setShelf(books)
      setPickedBookId(books.some((item) => item.id === prefer) ? prefer : (books[0]?.id ?? null))
    } catch {
      setShelf([]) // 取不到就退回手写书名，不挡着记
    }
  }

  // 只写日记的人不必为书架多花一次请求：按下「记的是一本书」才去取
  const openBookMode = async () => {
    setAsBook(true)
    setSaveError('')
    if (shelf === null) await refreshShelf(null)
  }

  const save = async () => {
    const content = draft.trim()
    if (!content || saving) return
    setSaving(true); setSaveError(''); setSavedTip('')
    try {
      if (asBook) {
        let justWrote = pickedBookId
        if (pickedBookId) {
          await readingService.addNote(pickedBookId, { content })
        } else {
          if (!book.trim()) { setSaveError('写下书名，她才知道记在哪本书下'); return }
          justWrote = (await readingService.logNote({ book: book.trim(), note: content }))?.bookId ?? null
        }
        setSavedTip('记下了')
        // 手写的书名可能刚上架：重新取一次书架，仍停在刚记的那本上，接着记第二条不用再挑
        await refreshShelf(justWrote)
      } else {
        await diaryService.saveDay(today(), { content, mood })
        setSavedTip(todayEntry ? '改好了' : '写好了')
      }
      setDraft(''); setBook('')
      await load(monthsBack)
    } catch {
      setSaveError('没保存成功，你写的还在')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    const target = pendingDelete
    setPendingDelete(null)
    if (!target) return
    try {
      if (target.type === 'diary') await diaryService.removeDay(target.day)
      else await readingService.deleteNote(target.id)
      await load(monthsBack)
    } catch { setSaveError('没删掉，请重试') }
  }

  const editToday = () => {
    setAsBook(false)
    setDraft(todayEntry?.content ?? '')
    setMood(todayEntry?.mood ?? 'neutral')
    setSavedTip('')
  }

  // 一条时间线：同一天里日记在前，读书笔记按时间倒序跟在后面
  const days = [...new Set([...entries.map((entry) => entry.day), ...notes.map((note) => note.createdAt.slice(0, 10))])].sort().reverse()
  const timeline = days.map((day) => ({
    day,
    entry: entries.find((item) => item.day === day) ?? null,
    notes: notes.filter((note) => note.createdAt.slice(0, 10) === day),
  })).filter((group) => group.entry || group.notes.length)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
      <Header title="手记" showBack />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <Card className="space-y-3 p-4">
          <div role="group" aria-label="今天的心情" className={`flex flex-wrap gap-2 ${asBook ? 'hidden' : ''}`}>
            {MOODS.map(({ value, label, icon: Icon }) => (
              <button key={value} type="button" aria-pressed={mood === value} onClick={() => setMood(value)} className={chipClass(mood === value)}>
                <Icon size={14} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>

          <label htmlFor="notes-draft" className="sr-only">手记内容</label>
          <textarea id="notes-draft" aria-label="手记内容" value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} maxLength={asBook ? NOTE_MAX : DIARY_MAX}
            placeholder={asBook ? '这本书里让你停下来的那一句' : '今天想记点什么'}
            className="w-full rounded-xl bg-surface-input p-3 text-sm leading-relaxed text-text-primary outline-none placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-status-info" />

          {asBook && (
            <>
              {shelf?.length ? (
                <div role="group" aria-label="记到哪本书下" className="flex flex-wrap gap-2">
                  {shelf.map((item) => (
                    <button key={item.id} type="button" aria-pressed={pickedBookId === item.id} onClick={() => setPickedBookId(item.id)} className={chipClass(pickedBookId === item.id)}>
                      {item.title}
                    </button>
                  ))}
                  <button type="button" aria-pressed={pickedBookId === null} onClick={() => setPickedBookId(null)} className={chipClass(pickedBookId === null)}>
                    不在书架上
                  </button>
                </div>
              ) : null}

              {pickedBookId === null && (
                <>
                  <label htmlFor="notes-book" className="sr-only">书名</label>
                  <input id="notes-book" aria-label="书名" value={book} onChange={(event) => setBook(event.target.value)} maxLength={80} placeholder="书名，比如《活着》"
                    className="min-h-11 w-full rounded-xl bg-surface-input px-3 text-sm text-text-primary" />
                </>
              )}
              <p className="text-xs text-text-muted">读书笔记最多 {NOTE_MAX} 个字。</p>
            </>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-pressed={asBook} onClick={() => (asBook ? (setAsBook(false), setSaveError('')) : openBookMode())} className={chipClass(asBook)}>
              <BookOpen size={14} aria-hidden="true" />
              记的是一本书
            </button>
            {!asBook && todayEntry && !draft && (
              <button type="button" onClick={editToday} className="min-h-11 text-xs text-text-secondary">改今天写的</button>
            )}
            <button type="button" disabled={saving || !draft.trim()} onClick={save}
              className="ml-auto min-h-11 rounded-xl bg-action-primary px-5 text-sm font-semibold text-text-inverse disabled:opacity-50">
              {saving ? '保存中…' : '记下来'}
            </button>
          </div>
          <p aria-live="polite" className="min-h-5 text-xs text-text-secondary">{saveError ? <span role="alert" className="text-danger">{saveError}</span> : savedTip}</p>
        </Card>

        {loadError && <p role="alert" className="text-sm text-danger">{loadError}<button type="button" className="ml-2 min-h-11 underline" onClick={() => load(monthsBack)}>重试</button></p>}

        {loading && timeline.length === 0 ? <p role="status" className="py-8 text-center text-sm text-text-muted">加载中…</p>
          : timeline.length === 0 ? <div className="rounded-card bg-surface-card shadow-card"><EmptyState icon={NotebookPen} title="还没有手记" description="写下今天，或者记一本书里的一句话。" /></div>
            : timeline.map((group) => (
              <section key={group.day} aria-label={dayLabel(group.day)} className="space-y-2">
                <h2 className="px-1 text-xs text-text-muted">{dayLabel(group.day)}</h2>
                {group.entry && (
                  <article className="rounded-card bg-surface-card p-4 shadow-card">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">{group.entry.content}</p>
                    <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
                      {moodOf(group.entry.mood) && <span className="flex items-center gap-1">{(() => { const Icon = moodOf(group.entry.mood).icon; return <Icon size={13} aria-hidden="true" /> })()}{moodOf(group.entry.mood).label}</span>}
                      <button type="button" aria-label={`删除 ${dayLabel(group.day)} 的日记`} onClick={() => setPendingDelete({ type: 'diary', day: group.day })} className="ml-auto flex h-11 w-11 items-center justify-center hover:text-danger"><Trash2 size={15} /></button>
                    </div>
                    {group.entry.aiComment && <p className="mt-2 border-t border-border-subtle pt-2 text-xs leading-relaxed text-text-secondary">她当时的回应：{group.entry.aiComment}</p>}
                  </article>
                )}
                {group.notes.map((note) => (
                  <article key={note.id} className="rounded-card bg-surface-card p-4 shadow-card">
                    <p className="text-xs text-text-muted">《{note.book || '未命名'}》{note.page != null && ` · 第 ${note.page} 页`}</p>
                    {note.quote && (
                      <blockquote className="mt-2 line-clamp-2 border-l-2 border-border-subtle pl-3 text-xs leading-relaxed text-text-muted">{note.quote}</blockquote>
                    )}
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-text-primary">{note.content}</p>
                    <div className="mt-2 flex items-center gap-2">
                      {note.bookId && note.locator && (
                        <Link to={`/tools/reading/${note.bookId}?at=${encodeURIComponent(note.locator)}`} className="flex min-h-11 items-center text-xs text-action-primary underline">
                          回到书里这一处
                        </Link>
                      )}
                      <button type="button" aria-label={`删除读书笔记：${note.content.slice(0, 12)}`} onClick={() => setPendingDelete({ type: 'note', id: note.id })} className="ml-auto flex h-11 w-11 items-center justify-center text-text-muted hover:text-danger"><Trash2 size={15} /></button>
                    </div>
                    {note.aiComment && (
                      <p className="mt-2 border-t border-border-subtle pt-2 text-xs leading-relaxed text-text-secondary">
                        {note.aiCommentSource === 'chat' ? '读这段时她说的：' : '她当时的回应：'}{note.aiComment}
                      </p>
                    )}
                  </article>
                ))}
              </section>
            ))}

        {hasOlder && timeline.length > 0 && (
          <button type="button" disabled={loading} onClick={() => setMonthsBack((months) => months + 1)} className="min-h-11 w-full text-xs text-text-muted disabled:opacity-50">
            {loading ? '正在翻出更早的…' : '看更早的'}
          </button>
        )}
      </div>

      <ConfirmDialog open={pendingDelete !== null} title={pendingDelete?.type === 'diary' ? '删掉这篇日记' : '删掉这条读书笔记'}
        description="删掉就找不回来了。" confirmLabel="确认删除" danger onConfirm={remove} onCancel={() => setPendingDelete(null)} />
    </div>
  )
}
