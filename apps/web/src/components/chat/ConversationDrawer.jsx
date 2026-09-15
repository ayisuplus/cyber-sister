import { useEffect, useRef } from 'react'
import ConversationList from '../layout/ConversationList'
import useDialogFocusTrap from '../ui/useDialogFocusTrap'

// 移动端（<641px）会话抽屉：ChatHeader 汉堡触发；选中/新建会话后自动关闭
export default function ConversationDrawer({ open, onClose }) {
  const dialogRef = useRef(null)
  const initialFocusRef = useRef(null)
  useDialogFocusTrap(open, dialogRef, initialFocusRef)

  // Esc 关闭抽屉
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div ref={dialogRef} tabIndex={-1} className="absolute inset-0 z-50 min-[641px]:hidden" role="dialog" aria-modal="true" aria-label="会话列表抽屉">
      <button type="button" aria-label="关闭会话列表" onClick={onClose} className="overlay-calm animate-overlay-in absolute inset-0" />
      <div className="animate-drawer-in absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col rounded-r-[28px] bg-surface-card shadow-lg">
        <ConversationList onNavigate={onClose} />
      </div>
    </div>
  )
}
