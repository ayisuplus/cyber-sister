import { useState } from 'react'
import { Plus, Smile, Send, Mic } from 'lucide-react'

export default function InputBar({ onSend, disabled }) {
  const [text, setText] = useState('')
  const [isFocused, setIsFocused] = useState(false)

  const handleSend = () => {
    if (!text.trim() || disabled) return
    onSend(text.trim())
    setText('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div 
      className="flex items-end gap-2 px-3 py-3 bg-white safe-area-bottom"
      style={{ 
        boxShadow: '0 -2px 8px rgba(0,0,0,0.06)',
        borderTop: '1px solid #EBEEF5'
      }}
    >
      {/* 附件按钮 */}
      <button 
        className="w-9 h-9 flex items-center justify-center text-[#B0B0C8] hover:text-[#FF6B9D] hover:bg-[#FF6B9D]/10 rounded-xl transition-all active:scale-95 mb-0.5"
      >
        <Plus size={22} />
      </button>

      {/* 输入框容器 */}
      <div className="flex-1 relative">
        <div 
          className={`relative rounded-2xl transition-all duration-200 ${
            isFocused 
              ? 'ring-2 ring-[#FF6B9D]/30 bg-white shadow-sm' 
              : 'bg-[#F5F5FA]'
          }`}
        >
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="和姐妹说点什么..."
            disabled={disabled}
            className="w-full h-10 bg-transparent rounded-2xl pl-4 pr-12 text-sm text-[#1A1A2E] placeholder:text-[#B0B0C8] outline-none"
          />
          
          {/* 表情按钮 */}
          <button 
            className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-[#B0B0C8] hover:text-[#FF6B9D] rounded-lg transition-colors"
          >
            <Smile size={18} />
          </button>
        </div>
      </div>

      {/* 发送/语音按钮 */}
      {text.trim() ? (
        <button
          onClick={handleSend}
          disabled={disabled}
          className="w-10 h-10 rounded-2xl flex items-center justify-center transition-all active:scale-95 mb-0.5"
          style={{ 
            background: 'linear-gradient(135deg, #FF6B9D 0%, #B5A6FF 100%)',
            boxShadow: '0 4px 12px rgba(255,107,157,0.4)'
          }}
        >
          <Send size={18} className="text-white ml-0.5" />
        </button>
      ) : (
        <button
          className="w-10 h-10 rounded-2xl bg-[#F5F5FA] flex items-center justify-center text-[#B0B0C8] hover:text-[#FF6B9D] hover:bg-[#FF6B9D]/10 transition-all active:scale-95 mb-0.5"
        >
          <Mic size={20} />
        </button>
      )}
    </div>
  )
}
