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
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-5">
      <div ref={dialogRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-[340px] rounded-3xl bg-surface-card p-6 text-center shadow-xl animate-fade-in">
        <h2 id={titleId} className="text-lg font-bold text-text-primary">{title}</h2>
        {children}
      </div>
    </div>
  )
}
