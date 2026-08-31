import { useState } from 'react'
import { Send } from 'lucide-react'

export default function InputBar({ onSend, disabled }) {
  const [text, setText] = useState('')

  const handleSend = async () => {
    if (!text.trim() || disabled) return
    const sent = await onSend(text.trim())
    if (sent) setText('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="safe-area-bottom flex items-end gap-2 border-t border-border-hairline bg-surface-card px-3 py-3 shadow-input">
      {/* 输入框容器 */}
      <div className="flex-1 relative">
        <div className="relative rounded-2xl bg-surface-input transition-all duration-200 focus-within:bg-surface-card focus-within:ring-2 focus-within:ring-status-info">
          <input
            type="text"
            aria-label="聊天消息"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="和姐妹说点什么..."
            disabled={disabled}
            className="min-h-11 w-full rounded-2xl bg-transparent px-4 text-sm text-text-primary outline-none placeholder:text-text-muted"
          />
        </div>
      </div>

      <button
        type="button"
        aria-label="发送消息"
        onClick={handleSend}
        disabled={disabled || !text.trim()}
        className="flex h-11 w-11 items-center justify-center rounded-2xl bg-action-primary text-text-inverse shadow-card transition-all active:scale-95 disabled:opacity-40"
      >
        <Send size={18} className="ml-0.5" />
      </button>
    </div>
  )
}
