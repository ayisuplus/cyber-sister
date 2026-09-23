import { useEffect, useRef } from 'react'
import AppNav from './AppNav'
import BrandMark from '../ui/BrandMark'
import useDialogFocusTrap from '../ui/useDialogFocusTrap'

// 移动端（<641px）导航抽屉：聊天页头的菜单按钮打开，点任一入口后自动关闭
export default function NavDrawer({ open, onClose }) {
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
    <div ref={dialogRef} tabIndex={-1} className="absolute inset-0 z-50 min-[641px]:hidden" role="dialog" aria-modal="true" aria-label="导航抽屉">
      <button type="button" aria-label="关闭导航" onClick={onClose} className="overlay-calm animate-overlay-in absolute inset-0" />
      <div className="animate-drawer-in absolute inset-y-0 left-0 flex w-64 max-w-[80vw] flex-col gap-2 rounded-r-[28px] bg-surface-card p-4 shadow-lg">
        <div className="px-2 pb-2 pt-1"><BrandMark /></div>
        <AppNav onNavigate={onClose} />
      </div>
    </div>
  )
}
