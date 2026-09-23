import { useState } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { readingService } from '../../services/readingService'
import ReadingAside from './ReadingAside'

const QUOTE_IN_MESSAGE = 200
const NOTE_MAX = 500
const ANSWER_MAX = 1000

const oneLine = (text) => text.replace(/\s+/g, ' ').trim()

/**
 * 读到一处停下来时的那一格：问问她，或者记一笔。
 * 问她走的是你和她唯一那段对话——回答显示在这儿，同一轮也留在对话里。
 */
export default function AskPanel({ mode, book, quote, passage, locator, onClose, onSaved }) {
  const sendMessage = useChatStore((state) => state.sendMessage)
  const isSending = useChatStore((state) => state.isSending)
  const latestReply = useChatStore((state) => {
    const last = state.messages.at(-1)
    return last?.role === 'assistant' ? last.content : ''
  })

  const [draft, setDraft] = useState('')
  const [asked, setAsked] = useState(false)
  const [error, setError] = useState('')
  const [tip, setTip] = useState('')
  const [busy, setBusy] = useState(false)

  const asking = mode === 'ask'
  const answer = asked ? latestReply : ''

  const ask = async () => {
    const question = draft.trim()
    if (!question || isSending) return
    setError(''); setTip(''); setAsked(true)
    const excerpt = quote ? oneLine(quote).slice(0, QUOTE_IN_MESSAGE) : ''
    const content = `读《${book.title}》时问：${question}${excerpt ? `\n\n> ${excerpt}` : ''}`
    try {
      await sendMessage(content, { reading: { bookId: book.id, passage } })
    } catch {
      setAsked(false)
      setError('没问成，过一会儿再试')
    }
  }

  const saveNote = async (content, aiComment = undefined) => {
    setBusy(true); setError(''); setTip('')
    try {
      await readingService.addNote(book.id, {
        content: content.slice(0, NOTE_MAX),
        quote: quote || undefined,
        locator,
        ...(aiComment ? { aiComment: aiComment.slice(0, ANSWER_MAX) } : {}),
      })
      setTip('记下了')
      onSaved?.()
    } catch {
      setError('没记下来，你写的还在')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ReadingAside
      label={asking ? '问问她' : '记一笔'}
      onClose={onClose}
      footer={
        <>
          <p aria-live="polite" className="min-h-5 text-xs text-text-secondary">
            {error ? <span role="alert" className="text-danger">{error}</span> : tip}
          </p>
          <button
            type="button"
            disabled={busy || isSending || !draft.trim()}
            onClick={() => (asking ? ask() : saveNote(draft.trim()))}
            className="min-h-11 w-full rounded-xl bg-action-primary px-5 text-sm font-semibold text-text-inverse disabled:opacity-50"
          >
            {asking ? (isSending ? '她在想…' : '问她') : (busy ? '记着…' : '记下来')}
          </button>
        </>
      }
    >
      {quote && (
        <blockquote className="border-l-2 border-border-subtle pl-3 text-xs leading-relaxed text-text-muted">
          {oneLine(quote).slice(0, 300)}
        </blockquote>
      )}

      {asking ? (
        <>
          <label htmlFor="reading-question" className="sr-only">想问她什么</label>
          <textarea
            id="reading-question" aria-label="想问她什么" rows={3} maxLength={500}
            value={draft} onChange={(event) => setDraft(event.target.value)}
            placeholder="读到这儿想问她什么"
            className="w-full rounded-xl bg-surface-input p-3 text-sm leading-relaxed text-text-primary outline-none placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-status-info"
          />
          <p className="text-xs leading-relaxed text-text-muted">问她的时候，选中的这一段会一起发给云端的模型。</p>
          {asked && (
            <div className="rounded-xl bg-surface-muted p-3">
              <p aria-live="polite" className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
                {answer || (isSending ? '她在看这一段…' : '')}
              </p>
              {answer && !isSending && (
                <button type="button" disabled={busy} onClick={() => saveNote(draft.trim(), answer)}
                  className="mt-2 min-h-11 text-xs text-action-primary underline disabled:opacity-50">
                  把这段问答记下来
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <label htmlFor="reading-note" className="sr-only">写下你的感想</label>
          <textarea
            id="reading-note" aria-label="写下你的感想" rows={4} maxLength={NOTE_MAX}
            value={draft} onChange={(event) => setDraft(event.target.value)}
            placeholder="这一段让你想到了什么"
            className="w-full rounded-xl bg-surface-input p-3 text-sm leading-relaxed text-text-primary outline-none placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-status-info"
          />
        </>
      )}
    </ReadingAside>
  )
}
