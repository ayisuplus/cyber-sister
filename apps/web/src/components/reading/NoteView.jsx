import { useState } from 'react'
import { format } from 'date-fns'
import ConfirmDialog from '../ui/ConfirmDialog'
import ReadingAside from './ReadingAside'
import { readingService } from '../../services/readingService'

// 点开正文里标着的那一句：看当时写了什么，以及读那段时她说过什么。
// 笔记只能删不能改（服务端没有改笔记这件事），删了就重新记一条。
export default function NoteView({ note, onClose, onDeleted }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const remove = async () => {
    setBusy(true); setError('')
    try {
      await readingService.deleteNote(note.id)
      setConfirming(false)
      onDeleted?.()
      onClose()
    } catch {
      setError('没删掉，请重试')
      setBusy(false)
    }
  }

  return (
    <>
      <ReadingAside
        label="你在这里记过"
        onClose={onClose}
        footer={
          <>
            <p aria-live="polite" className="min-h-5 text-xs text-text-secondary">
              {error ? <span role="alert" className="text-danger">{error}</span> : null}
            </p>
            <button type="button" onClick={() => setConfirming(true)} className="min-h-11 text-xs text-text-muted hover:text-danger">
              删掉这条笔记
            </button>
          </>
        }
      >
        {note.quote && (
          <blockquote className="border-l-2 border-border-subtle pl-3 text-xs leading-relaxed text-text-muted">{note.quote}</blockquote>
        )}
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">{note.content}</p>
        {note.aiComment && (
          <p className="border-t border-border-subtle pt-2 text-xs leading-relaxed text-text-secondary">
            {note.aiCommentSource === 'chat' ? '读这段时她说的：' : '她当时的回应：'}{note.aiComment}
          </p>
        )}
        {note.createdAt && (
          <p className="text-xs text-text-muted">{format(new Date(note.createdAt), 'yyyy年M月d日')}</p>
        )}
      </ReadingAside>

      <ConfirmDialog
        open={confirming}
        title="删掉这条笔记"
        description="删掉就找不回来了，正文里的标记也会一起消失。"
        confirmLabel="确认删除" danger busy={busy}
        onConfirm={remove} onCancel={() => setConfirming(false)}
      />
    </>
  )
}
