import { useRef } from 'react'
import { Heart, Phone } from 'lucide-react'
import useDialogFocusTrap from '../ui/useDialogFocusTrap'

export default function CrisisModal({ intervention, onClose }) {
  const dialogRef = useRef(null)
  const closeRef = useRef(null)

  useDialogFocusTrap(Boolean(intervention), dialogRef, closeRef)

  if (!intervention) return null

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-5">
      <div ref={dialogRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="crisis-title" aria-describedby="crisis-message" className="w-full max-w-[340px] rounded-3xl bg-surface-card p-6 text-center shadow-xl">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-pastel-blush">
          <Heart size={32} className="text-danger" />
        </div>
        <h2 id="crisis-title" className="text-lg font-bold text-text-primary">我很担心你</h2>
        <p id="crisis-message" className="mt-3 text-sm leading-relaxed text-text-secondary">{intervention.message}</p>

        {Array.isArray(intervention.resources) && intervention.resources.length > 0 && (
          <div className="mt-5 space-y-2">
            {intervention.resources.map((resource) => {
              const label = typeof resource === 'string' ? resource : resource.label || resource.name
              const number = typeof resource === 'string' ? null : resource.number
              const guidance = typeof resource === 'string' ? null : resource.guidance
              return number ? (
                <a key={`${label}-${number}`} href={`tel:${number}`} className="flex min-h-11 items-center gap-3 rounded-xl bg-surface-muted p-3 text-left hover:bg-pastel-blush">
                  <Phone size={16} className="shrink-0 text-brand-pink" />
                  <span className="text-sm text-text-primary">{label}：{number}</span>
                </a>
              ) : (
                <p key={label} className="rounded-xl bg-surface-muted p-3 text-left text-sm text-text-primary">
                  <strong className="block">{label}</strong>
                  {guidance && <span className="mt-1 block text-xs text-text-secondary">{guidance}</span>}
                </p>
              )
            })}
          </div>
        )}

        <button ref={closeRef} type="button" onClick={onClose} className="mt-6 min-h-12 w-full rounded-[12px] bg-action-primary hover:bg-action-hover font-semibold text-text-inverse focus:ring-2 focus:ring-status-info" style={{ boxShadow: 'var(--cs-shadow-button)' }}>
          我知道了
        </button>
      </div>
    </div>
  )
}
