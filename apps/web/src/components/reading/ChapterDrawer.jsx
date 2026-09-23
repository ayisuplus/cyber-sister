import { useEffect, useRef } from 'react'
import useDialogFocusTrap from '../ui/useDialogFocusTrap'
import { noteChapter } from '../../lib/bookNotes'

// 这本书的一切：字号、目录，和你在这本书里记过的。点一条就跳过去并关上。
const FONT_CHOICES = [{ size: 16, label: '小' }, { size: 18, label: '中' }, { size: 20, label: '大' }]
const rowClass = (on) => `flex min-h-11 w-full flex-col justify-center rounded-control px-3 py-2 text-left text-sm leading-relaxed transition-colors duration-300 ease-calm ${on ? 'bg-pastel-blush text-action-primary' : 'text-text-secondary hover:bg-surface-muted'}`

export default function ChapterDrawer({ open, chapters, current, fontSize, onFontSize, onPick, onClose, notes = [], onPickNote }) {
  const dialogRef = useRef(null)
  const initialFocusRef = useRef(null)
  useDialogFocusTrap(open, dialogRef, initialFocusRef)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div ref={dialogRef} tabIndex={-1} className="absolute inset-0 z-50" role="dialog" aria-modal="true" aria-label="目录">
      <button type="button" aria-label="关闭目录" onClick={onClose} className="overlay-calm animate-overlay-in absolute inset-0" />
      <div className="animate-drawer-in absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col rounded-r-[28px] bg-surface-card shadow-lg">
        <div role="group" aria-label="字号" className="flex shrink-0 items-center gap-2 px-5 pt-5">
          <span className="text-sm text-text-muted">字号</span>
          {FONT_CHOICES.map(({ size, label }) => (
            <button
              key={size} type="button" aria-pressed={fontSize === size} onClick={() => onFontSize(size)}
              className={`flex min-h-11 items-center rounded-full border px-3 text-xs transition-colors duration-300 ease-calm ${fontSize === size ? 'border-action-primary bg-pastel-blush text-action-primary' : 'border-border-subtle text-text-secondary'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <h2 className="px-3 pb-2 pt-4 text-sm text-text-muted">目录</h2>
          <nav aria-label="章节">
            {chapters.map((chapter, index) => (
              <button
                key={index}
                type="button"
                ref={index === current ? initialFocusRef : null}
                aria-current={index === current ? 'true' : undefined}
                onClick={() => { onPick(index); onClose() }}
                className={rowClass(index === current)}
              >
                {chapter.title}
              </button>
            ))}
          </nav>

          {notes.length > 0 && (
            <>
              <h2 className="px-3 pb-2 pt-5 text-sm text-text-muted">你记过的（{notes.length}）</h2>
              <nav aria-label="这本书的笔记">
                {notes.map((note) => {
                  const index = noteChapter(note.locator)
                  const where = index !== null && chapters[index] ? chapters[index].title : '没有位置'
                  return (
                    <button key={note.id} type="button" onClick={() => { onPickNote(note); onClose() }} className={rowClass(false)}>
                      <span className="truncate text-xs text-text-muted">{where}</span>
                      <span className="line-clamp-2">{note.content}</span>
                    </button>
                  )
                })}
              </nav>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
