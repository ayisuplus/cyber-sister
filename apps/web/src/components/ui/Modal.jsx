import { useId, useRef } from 'react'
import useDialogFocusTrap from './useDialogFocusTrap'

// 与 CrisisModal 同款遮罩/面板结构；不加 Escape 关闭，关闭入口由 children 内的按钮承担
export default function Modal({ open, title, children }) {
  const dialogRef = useRef(null)
  const initialFocusRef = useRef(null)
  const titleId = useId()

  useDialogFocusTrap(open, dialogRef, initialFocusRef)

  if (!open) return null

  return (
    <div className="overlay-calm animate-overlay-in absolute inset-0 z-50 flex items-center justify-center p-5">
      <div ref={dialogRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby={titleId} className="animate-dialog-in w-full max-w-[340px] rounded-card bg-surface-card p-6 text-center shadow-lg">
        <h2 id={titleId} className="text-lg font-bold text-text-primary">{title}</h2>
        {children}
      </div>
    </div>
  )
}
