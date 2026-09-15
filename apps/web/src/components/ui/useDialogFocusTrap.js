import { useEffect } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable]',
  'audio[controls]',
  'video[controls]',
].join(',')

export default function useDialogFocusTrap(open, dialogRef, initialFocusRef) {
  useEffect(() => {
    if (!open || !dialogRef.current) return undefined

    const dialog = dialogRef.current
    const previousFocus = document.activeElement
    const focusableElements = () => Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR))

    ;(initialFocusRef.current || focusableElements()[0] || dialog).focus()

    const trapFocus = (event) => {
      if (event.key !== 'Tab') return

      const elements = focusableElements()
      if (elements.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = elements[0]
      const last = elements[elements.length - 1]
      const active = document.activeElement
      const activeIsFocusable = elements.includes(active)
      if (event.shiftKey && (active === first || !activeIsFocusable)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !activeIsFocusable)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', trapFocus)
    return () => {
      document.removeEventListener('keydown', trapFocus)
      // 新弹层可能已经接管焦点；关闭旧弹层时不把用户带回背景页面。
      const focusedModal = document.activeElement?.closest('[aria-modal="true"]')
      if (focusedModal && focusedModal !== dialog) return
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [dialogRef, initialFocusRef, open])
}
