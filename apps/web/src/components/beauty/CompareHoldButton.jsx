import { useState } from 'react'
import { Eye } from 'lucide-react'

// 长按看原图：按下（指针或空格/回车）期间通知父组件展示原图，松开恢复效果图。
export default function CompareHoldButton({ onHoldChange, disabled = false }) {
  const [holding, setHolding] = useState(false)

  const startHold = () => {
    if (disabled || holding) return
    setHolding(true)
    onHoldChange(true)
  }
  const endHold = () => {
    if (!holding) return
    setHolding(false)
    onHoldChange(false)
  }

  const handleKeyDown = (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      startHold()
    }
  }
  const handleKeyUp = (event) => {
    if (event.key === ' ' || event.key === 'Enter') endHold()
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={holding}
      onPointerDown={startHold}
      onPointerUp={endHold}
      onPointerLeave={endHold}
      onPointerCancel={endHold}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      className={`flex min-h-11 flex-1 select-none items-center justify-center gap-2 rounded-2xl border text-sm font-semibold transition-colors ${
        holding
          ? 'border-action-primary bg-pastel-apricot text-action-primary'
          : 'border-border-default bg-surface-card text-text-secondary'
      } disabled:opacity-50`}
    >
      <Eye size={16} aria-hidden="true" />
      {holding ? '正在看原图' : '长按看原图'}
    </button>
  )
}
