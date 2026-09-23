import { X } from 'lucide-react'

// 阅读页旁边那一格：窄屏是从底部升起的一层，宽屏是右栏。
// 问她、记一笔、看这一条笔记都落在这同一个位置——不另开面板、不另开页。
export default function ReadingAside({ label, onClose, children, footer = null }) {
  return (
    <aside
      aria-label={label}
      className="animate-drawer-in absolute inset-x-0 bottom-0 z-40 flex max-h-[70vh] flex-col gap-3 rounded-t-[28px] bg-surface-card p-4 shadow-lg min-[900px]:static min-[900px]:max-h-none min-[900px]:w-80 min-[900px]:shrink-0 min-[900px]:animate-none min-[900px]:rounded-none min-[900px]:border-l min-[900px]:border-border-subtle min-[900px]:shadow-none"
    >
      <div className="flex shrink-0 items-center justify-between">
        <h2 className="text-sm text-text-secondary">{label}</h2>
        <button type="button" aria-label="关掉这一格" onClick={onClose} className="flex h-11 w-11 items-center justify-center text-text-muted hover:text-text-primary">
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">{children}</div>

      {footer ? <div className="shrink-0">{footer}</div> : null}
    </aside>
  )
}
