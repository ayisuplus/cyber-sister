import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pause, Play, X } from 'lucide-react'
import { useLandscapePhone } from '../../hooks/useLandscapePhone'
import useDialogFocusTrap from '../ui/useDialogFocusTrap'
import { WORKSPACE_GROUPS, WORKSPACE_MEDIA } from '../../features/workspaces'
import AmbientMedia from './AmbientMedia'
import { WorkHubActions, WorkHubPicker } from './WorkHubNavigation'
import './work-desktop.css'

// 横竖屏共享当前任务主题；关闭后本次横屏不再自动弹出。
export default function LandscapeDesk({ activeId, onSelect, paused, onToggleMotion, onOpenChange }) {
  const active = useLandscapePhone()
  const [dismissed, setDismissed] = useState(false)
  const dialogRef = useRef(null)
  const closeRef = useRef(null)
  const actionsId = useId()
  const headingId = useId()
  const open = active && !dismissed
  const group = WORKSPACE_GROUPS.find(item => item.id === activeId)

  useDialogFocusTrap(open, dialogRef, closeRef)

  // 沉浸层是可选装饰：已有或新出现的正式弹层始终优先，本次横屏不再自动夺回。
  useLayoutEffect(() => {
    if (!active || dismissed) return undefined
    const yieldToModal = () => {
      const otherModal = Array.from(document.querySelectorAll('[aria-modal="true"]')).some(element => (
        element !== dialogRef.current && !element.closest('[hidden], [aria-hidden="true"], [inert]')
      ))
      if (otherModal) setDismissed(true)
    }
    yieldToModal()
    const observer = new MutationObserver(yieldToModal)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'aria-hidden', 'hidden', 'inert'] })
    return () => observer.disconnect()
  }, [active, dismissed])

  useEffect(() => {
    if (!active) setDismissed(false)
  }, [active])

  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = event => {
      if (event.key === 'Escape') setDismissed(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!open) return null

  return createPortal(
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="沉浸书桌" className={`work-landscape-desk${paused ? ' is-paused' : ''}`}>
      <div className="work-landscape-background" aria-hidden="true">
        <AmbientMedia {...WORKSPACE_MEDIA} paused={paused} className="work-desk-media" />
        <div className="work-landscape-shade" />
      </div>
      <div className="work-landscape-topbar">
        <div>
          <h2>坐进她的书桌</h2>
          <p><span className="work-landscape-ai">Amie · AI 陪伴</span> 云端接口预览 · 尚未连接</p>
        </div>
        <div className="work-landscape-controls">
          <button type="button" className="work-landscape-control" onClick={onToggleMotion} aria-label={paused ? '开启动效' : '暂停动效'}>
            {paused ? <Play size={17} aria-hidden="true" /> : <Pause size={17} aria-hidden="true" />}
          </button>
          <button ref={closeRef} type="button" className="work-landscape-control" aria-label="关闭沉浸模式" onClick={() => setDismissed(true)}>
            <X size={19} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="work-landscape-content">
        <WorkHubPicker compact activeId={activeId} onSelect={onSelect} controlsId={actionsId} />
        <section id={actionsId} aria-labelledby={headingId} className="work-landscape-actions">
          <h3 id={headingId} aria-live="polite">{group.title}</h3>
          <WorkHubActions key={activeId} compact group={group} onNavigate={() => setDismissed(true)} />
        </section>
      </div>
    </div>,
    document.body,
  )
}
