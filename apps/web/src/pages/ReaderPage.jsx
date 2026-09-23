import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { List } from 'lucide-react'
import Header from '../components/layout/Header'
import ChapterDrawer from '../components/reading/ChapterDrawer'
import AskPanel from '../components/reading/AskPanel'
import NoteView from '../components/reading/NoteView'
import { readingService } from '../services/readingService'
import { bookStore } from '../services/bookStore'
import { chapterNotes, markChapter, noteChapter } from '../lib/bookNotes'

// 读一本书：正文在这台设备上，滚动到哪儿就往服务端回存一下进度。
// 选中一段可以问她或记一笔——问她走的是你和她唯一那段对话。
// 从手记点「回到书里这一处」进来时是「回看」：看一眼不会把你当前的进度拖回去。
const FONT_SIZES = [16, 18, 20]
const FONT_KEY = 'amie-reader-font'
const PASSAGE_AROUND = 700
const SAVE_DELAY = 1200

const readFontSize = () => {
  try {
    const saved = Number(localStorage.getItem(FONT_KEY))
    return FONT_SIZES.includes(saved) ? saved : FONT_SIZES[1]
  } catch {
    return FONT_SIZES[1]
  }
}

/** locator 形如 "章序号:章内字符偏移"；读不出来就从头开始。 */
const parseLocator = (locator) => {
  const chapter = noteChapter(locator)
  if (chapter === null) return { chapter: 0, offset: 0 }
  return { chapter, offset: Number.parseInt(String(locator).split(':')[1], 10) || 0 }
}

/** 一章的正文与前后翻页；你划过的句子带一道底纹，点一下看当时写的。 */
function ChapterBody({ title, segments, fontSize, index, total, onSelect, onGoto, onOpenNote }) {
  return (
    <>
      <article aria-label={title} onMouseUp={onSelect} onTouchEnd={onSelect} className="mx-auto max-w-[34rem]">
        <h2 className="display-serif mb-6 text-base font-semibold text-text-secondary">{title}</h2>
        <p className="whitespace-pre-wrap font-serif text-text-primary" style={{ fontSize: `${fontSize}px`, lineHeight: 1.9 }}>
          {segments.map((segment, order) => (segment.note ? (
            <button
              key={order} type="button"
              aria-label={`你在这里记过：${segment.note.content.slice(0, 20)}`}
              onClick={() => onOpenNote(segment.note)}
              className="inline rounded-sm bg-pastel-apricot text-left text-inherit underline decoration-action-primary/40 decoration-1 underline-offset-4"
            >
              {segment.text}
            </button>
          ) : <span key={order}>{segment.text}</span>))}
        </p>
      </article>
      <div className="mx-auto mt-10 flex max-w-[34rem] items-center gap-3">
        <button type="button" disabled={index === 0} onClick={() => onGoto(index - 1)}
          className="min-h-11 text-xs text-text-muted disabled:opacity-40">上一章</button>
        <span className="flex-1 text-center text-xs text-text-muted">{index + 1} / {total}</span>
        <button type="button" disabled={index === total - 1} onClick={() => onGoto(index + 1)}
          className="min-h-11 text-xs text-text-muted disabled:opacity-40">下一章</button>
      </div>
    </>
  )
}

/** 选中一段之后的两个动作；窄屏贴在底部，宽屏是右栏，只有一处 DOM。 */
function SelectionBar({ onAsk, onNote, onCancel }) {
  return (
    <div
      role="group" aria-label="选中的这一段"
      className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-border-subtle bg-surface-card px-4 py-2 min-[900px]:static min-[900px]:w-80 min-[900px]:shrink-0 min-[900px]:flex-col min-[900px]:items-stretch min-[900px]:border-l min-[900px]:border-t-0 min-[900px]:p-4"
    >
      <button type="button" onClick={onAsk} className="min-h-11 flex-1 rounded-xl bg-action-primary px-4 text-sm font-semibold text-text-inverse min-[900px]:flex-none">问问她</button>
      <button type="button" onClick={onNote} className="min-h-11 flex-1 rounded-xl bg-surface-muted px-4 text-sm text-text-primary min-[900px]:flex-none">记一笔</button>
      <button type="button" aria-label="取消选中" onClick={onCancel} className="min-h-11 px-2 text-xs text-text-muted">取消</button>
    </div>
  )
}

/** 旁边那一格里此刻该放什么：问她、记一笔，或者看你记过的那一条。 */
function ReadingPanel({ panel, book, selection, viewing, onClose, onSaved, onDeleted }) {
  if (panel === 'view' && viewing) {
    return <NoteView note={viewing} onClose={onClose} onDeleted={onDeleted} />
  }
  if (book && selection) {
    return (
      <AskPanel
        mode={panel} book={book} quote={selection.quote} passage={selection.passage} locator={selection.locator}
        onClose={onClose} onSaved={onSaved}
      />
    )
  }
  return null
}

export default function ReaderPage() {
  const { bookId } = useParams()
  const [params] = useSearchParams()
  const jumpTo = params.get('at')
  const navigate = useNavigate()
  const bodyRef = useRef(null)
  const restoreRef = useRef(null)
  const saveTimer = useRef(null)

  const [book, setBook] = useState(null)
  const [chapters, setChapters] = useState([])
  const [notes, setNotes] = useState([])
  const [index, setIndex] = useState(0)
  const [fontSize, setFontSize] = useState(readFontSize)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selection, setSelection] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [panel, setPanel] = useState(null)
  const [peeking, setPeeking] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const loadNotes = useCallback(async () => {
    try {
      setNotes(await readingService.listNotes(bookId))
    } catch {
      // 笔记取不到不挡着读，正文照常翻
    }
  }, [bookId])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const shelf = await readingService.listBooks()
      const found = shelf.find((item) => item.id === bookId)
      if (!found) throw new Error('missing')
      const stored = await bookStore.getBook(bookId)
      if (!stored?.chapters?.length) {
        setBook(found)
        setLoadError(`《${found.title}》的文件不在这台设备上，回书架重新放一次就能接着读`)
        return
      }
      // 带 ?at= 进来是回看某一条笔记：落在那一处，且这次不回存进度
      const at = parseLocator(jumpTo ?? found.locator)
      restoreRef.current = at
      setPeeking(Boolean(jumpTo))
      setBook(found)
      setChapters(stored.chapters)
      setIndex(Math.min(at.chapter, stored.chapters.length - 1))
      await loadNotes()
    } catch {
      setLoadError('这本书打不开了，回书架看看')
    } finally {
      setLoading(false)
    }
  }, [bookId, jumpTo, loadNotes])

  useEffect(() => { load() }, [load])

  // 翻到新一章从头看；从进度（或某条笔记）回来的那一次滚回原处
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body || !chapters.length) return
    const pending = restoreRef.current
    if (pending && pending.chapter === index) {
      restoreRef.current = null
      const length = chapters[index]?.text.length || 1
      body.scrollTop = Math.min(1, pending.offset / length) * body.scrollHeight
    } else if (!pending) {
      body.scrollTop = 0
    }
  }, [index, chapters])

  const saveProgress = useCallback(() => {
    const body = bodyRef.current
    if (!body || !chapters.length || !book || peeking) return
    const span = body.scrollHeight - body.clientHeight
    const ratio = span > 0 ? Math.min(1, Math.max(0, body.scrollTop / span)) : 0
    const percent = Math.round(((index + ratio) / chapters.length) * 100)
    const offset = Math.round(ratio * (chapters[index]?.text.length || 0))
    readingService.saveProgress(book.id, { locator: `${index}:${offset}`, percent }).catch(() => {
      // 进度存不上不打断阅读，下次滚动还会再试
    })
  }, [book, chapters, index, peeking])

  const onScroll = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(saveProgress, SAVE_DELAY)
  }

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  const closePanel = () => { setPanel(null); setSelection(null); setViewing(null) }

  const goto = (next, at = null) => {
    if (next < 0 || next >= chapters.length) return
    restoreRef.current = at
    closePanel()
    setIndex(next)
  }

  const openNote = (note) => {
    setSelection(null)
    setViewing(note)
    setPanel('view')
  }

  // 从抽屉里点一条笔记：有位置就跳过去，没位置的直接看
  const pickNote = (note) => {
    const at = noteChapter(note.locator)
    if (at !== null && at < chapters.length) {
      goto(at, parseLocator(note.locator))
    }
    openNote(note)
  }

  const changeFont = (size) => {
    setFontSize(size)
    try { localStorage.setItem(FONT_KEY, String(size)) } catch { /* 记不住字号不影响阅读 */ }
  }

  // 选中一段：连同前后文一起备好，问她时作为资料发过去
  const captureSelection = () => {
    const picked = window.getSelection()?.toString()?.trim() ?? ''
    if (picked.length < 2) return
    const text = chapters[index]?.text ?? ''
    const at = text.indexOf(picked)
    const start = at >= 0 ? Math.max(0, at - PASSAGE_AROUND) : 0
    const end = at >= 0 ? at + picked.length + PASSAGE_AROUND : PASSAGE_AROUND * 2
    setSelection({
      quote: picked.slice(0, 1000),
      passage: text.slice(start, end),
      locator: `${index}:${at >= 0 ? at : 0}`,
    })
  }

  const chapter = chapters[index]
  const segments = useMemo(
    () => (chapter ? markChapter(chapter.text, chapterNotes(notes, index)) : []),
    [chapter, notes, index]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
      <Header
        title={book?.title ?? '读书'}
        showBack
        rightAction={chapters.length ? (
          <button type="button" aria-label="目录与字号" onClick={() => setDrawerOpen(true)}
            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-muted">
            <List size={18} aria-hidden="true" className="text-text-primary" />
          </button>
        ) : null}
      />

      {/* 轻提示用 blush：action-primary 在 pastel-mist 上只有 4.48，过不了 AA */}
      {peeking && (
        <p className="flex shrink-0 items-center gap-3 border-b border-border-subtle bg-pastel-blush px-4 py-2 text-xs text-text-secondary">
          正在回看你记过的地方，读到哪儿不会被改掉
          <button type="button" onClick={() => { setPeeking(false); setSelection(null) }} className="ml-auto min-h-11 shrink-0 text-action-primary underline">
            从这儿接着读
          </button>
        </p>
      )}

      <div className="relative flex min-h-0 flex-1">
        <div ref={bodyRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
          {loading ? <p role="status" className="py-8 text-center text-sm text-text-muted">加载中…</p>
            : loadError ? (
              <p role="alert" className="py-8 text-center text-sm text-danger">
                {loadError}
                <button type="button" className="ml-2 min-h-11 underline" onClick={() => navigate('/tools/reading')}>回书架</button>
              </p>
            ) : chapter ? (
              <ChapterBody
                title={chapter.title} segments={segments} fontSize={fontSize}
                index={index} total={chapters.length}
                onSelect={captureSelection} onGoto={goto} onOpenNote={openNote}
              />
            ) : null}
        </div>

        {selection && !panel && (
          <SelectionBar onAsk={() => setPanel('ask')} onNote={() => setPanel('note')} onCancel={() => setSelection(null)} />
        )}

        {panel && (
          <ReadingPanel
            panel={panel} book={book} selection={selection} viewing={viewing}
            onClose={closePanel} onSaved={loadNotes} onDeleted={loadNotes}
          />
        )}
      </div>

      <ChapterDrawer
        open={drawerOpen}
        chapters={chapters}
        current={index}
        fontSize={fontSize}
        notes={notes}
        onFontSize={changeFont}
        onPick={goto}
        onPickNote={pickNote}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  )
}
