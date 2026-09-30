import { useRef } from 'react'
import { useComplianceStore } from '../../stores/complianceStore'
import useDialogFocusTrap from '../ui/useDialogFocusTrap'
import { Bot } from 'lucide-react'

export default function AIDisclaimer() {
  const showAIDisclaimer = useComplianceStore(s => s.showAIDisclaimer)
  const dismissDisclaimer = useComplianceStore(s => s.dismissDisclaimer)
  const dialogRef = useRef(null)
  const closeRef = useRef(null)

  useDialogFocusTrap(showAIDisclaimer, dialogRef, closeRef)

  if (!showAIDisclaimer) return null

  return (
    <div
      className="overlay-calm animate-overlay-in absolute inset-0 z-50 flex items-center justify-center"
    >
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="ai-disclaimer-title" aria-describedby="ai-disclaimer-description" className="animate-dialog-in bg-surface-card rounded-card w-[320px] p-8 text-center shadow-lg">
        <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-gradient-pink-purple flex items-center justify-center">
          <Bot size={32} className="text-text-inverse" />
        </div>
        <h2 id="ai-disclaimer-title" className="text-lg font-bold text-text-primary mb-3">我是AI，不是真人</h2>
        <p id="ai-disclaimer-description" className="text-sm text-text-secondary leading-relaxed mb-6">
          我不是真人。我能陪你聊、记住你说过的事；我不做心理咨询，不是你的恋人，也不替你做重大决定。真要有人搭把手的时候，去找身边信得过的人，或者专业的人。
        </p>
        <button
          ref={closeRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            dismissDisclaimer()
          }}
          className="w-full min-h-12 bg-action-primary hover:bg-action-hover text-text-inverse font-semibold rounded-control transition-colors duration-300 ease-calm focus-visible:ring-2 focus-visible:ring-status-info shadow-button"
        >
          我知道了
        </button>
      </div>
    </div>
  )
}
