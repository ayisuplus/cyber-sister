import { useRef } from 'react'
import { useComplianceStore } from '../../stores/complianceStore'
import useDialogFocusTrap from './useDialogFocusTrap'
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
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
    >
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="ai-disclaimer-title" aria-describedby="ai-disclaimer-description" className="bg-surface-card rounded-[24px] w-[320px] p-8 text-center animate-fade-in">
        <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-gradient-pink-purple flex items-center justify-center">
          <Bot size={32} className="text-white" />
        </div>
        <h2 id="ai-disclaimer-title" className="text-lg font-bold text-text-primary mb-3">我是AI，不是真人</h2>
        <p id="ai-disclaimer-description" className="text-sm text-text-secondary leading-relaxed mb-6">
          我会一直陪着你，但我不是真人。如果你需要真正的帮助，请联系身边的朋友或专业机构。
        </p>
        <button
          ref={closeRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            dismissDisclaimer()
          }}
          className="w-full min-h-12 bg-action-primary hover:bg-action-hover text-text-inverse font-semibold rounded-[12px] focus:ring-2 focus:ring-status-info"
          style={{ boxShadow: 'var(--cs-shadow-button)' }}
        >
          我知道了
        </button>
      </div>
    </div>
  )
}
