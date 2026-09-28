import { useEffect, useId, useRef } from 'react'
import { DayPartDoodle, Sticker } from '../letter/Decor'
import useDialogFocusTrap from '../ui/useDialogFocusTrap'

const primary = 'inline-flex min-h-11 w-full items-center justify-center rounded-control bg-action-primary px-4 text-sm font-semibold text-text-inverse shadow-button transition-colors duration-300 ease-calm hover:bg-action-hover focus-visible:ring-2 focus-visible:ring-status-info'
const secondary = 'inline-flex min-h-11 w-full items-center justify-center rounded-control border border-border-default bg-surface-card px-4 text-sm font-semibold text-text-secondary transition-colors duration-300 ease-calm hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-status-info'

const clockOf = (value) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/**
 * 早安卡（路线图 C28）：闹钟响时盖满整屏。大字是时间，下面是那天早上的一句，古诗词再小字注出处。
 * 「起来了」停铃并收起；「再躺五分钟」停铃，五分钟后再响（最多两次）。Esc 等同「起来了」。
 * @param {{ note: { fireAt: string, line?: { text: string, source?: string } | null }, silent: boolean, canSnooze: boolean, onGetUp: () => void, onSnooze: () => void }} props
 */
export default function WakeCard({ note, silent, canSnooze, onGetUp, onSnooze }) {
  const dialogRef = useRef(null)
  const getUpRef = useRef(null)
  const titleId = useId()
  useDialogFocusTrap(true, dialogRef, getUpRef)

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onGetUp() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onGetUp])

  const line = note?.line
  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="wake-card fixed inset-0 z-[60] flex flex-col items-center justify-center overflow-y-auto px-6 py-10 text-center"
    >
      <div className="flex w-full max-w-sm flex-col items-center">
        <DayPartDoodle phase="dawn" size={30} className="wake-card__meta" />
        <h2 id={titleId} className="mt-2 text-sm tracking-[0.3em] wake-card__meta">早安</h2>
        <p className="mt-1 font-display text-6xl font-semibold tabular-nums">{clockOf(note?.fireAt)}</p>
        {line?.text ? (
          <blockquote className="mt-8">
            <p className="wake-card__line whitespace-pre-line font-hand text-2xl leading-relaxed">{line.text}</p>
            {line.source && <footer className="wake-card__source mt-3 text-xs">——{line.source}</footer>}
          </blockquote>
        ) : (
          <p className="wake-card__line mt-8 font-hand text-2xl leading-relaxed">天亮了，慢慢醒。</p>
        )}
        <Sticker name="forget-me-not" size={40} className="mt-6" />
        <div className="mt-8 w-full space-y-3">
          <button ref={getUpRef} type="button" onClick={onGetUp} className={primary}>起来了</button>
          {canSnooze && <button type="button" onClick={onSnooze} className={secondary}>再躺五分钟</button>}
        </div>
        {silent && (
          <p className="wake-card__meta mt-4 text-xs leading-relaxed">
            这次没能出声：页面打开后还没被点过，浏览器不让网页自己放声音。
          </p>
        )}
      </div>
    </div>
  )
}
