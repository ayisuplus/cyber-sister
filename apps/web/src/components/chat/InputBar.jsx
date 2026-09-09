import { useRef, useState } from 'react'
import { ImagePlus, Mic, Send, Square, X } from 'lucide-react'
import Spinner from '../ui/Spinner'
import { useVoiceInput } from './useVoiceInput'
import { useChatStore } from '../../stores/chatStore'
import { prepareChatImage } from '../../features/chat/imageResize'

export default function InputBar({ onSend, disabled }) {
  const [text, setText] = useState('')
  const [image, setImage] = useState(null) // null | { blob, previewUrl }
  const [imageError, setImageError] = useState('')
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const chatMode = useChatStore(state => state.chatMode)
  const voice = useVoiceInput((transcript) => {
    setText(prev => (prev ? `${prev} ${transcript}` : transcript))
  })

  const handleImagePicked = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 允许重选同一文件
    if (!file) return
    setImageError('')
    try {
      setImage(await prepareChatImage(file))
    } catch (error) {
      setImageError(error.message || '图片读取失败，请换一张')
    }
  }

  const removeImage = () => setImage(null)

  const handleSend = async () => {
    if ((text.trim() === '' && !image) || disabled) return
    const sent = await onSend(text.trim(), { image })
    if (sent) {
      setText('')
      setImage(null)
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
    }
  }

  // IME 组词中 Enter 是选字，不得发送；Shift+Enter 换行
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  // 自动增高，上限 120px，超出出滚动条
  const handleChange = (e) => {
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
    el.style.overflowY = el.scrollHeight > 120 ? 'auto' : 'hidden'
    setText(el.value)
  }

  return (
    <div className="safe-area-bottom border-t border-border-hairline bg-surface-card px-3 py-3 shadow-input">
      <div className="flex items-end gap-2">
        {/* 输入框容器 */}
        <div className="flex-1 relative">
          {image && (
            <div className="mb-2 flex items-center gap-2">
              <img src={image.previewUrl} alt="待发送的照片预览" className="h-16 w-16 rounded-2xl object-cover" />
              <button
                type="button"
                aria-label="移除照片"
                onClick={removeImage}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-input text-text-secondary"
              >
                <X size={14} />
              </button>
            </div>
          )}
          <div className="relative rounded-2xl bg-surface-input transition-all duration-200 focus-within:bg-surface-card focus-within:ring-2 focus-within:ring-status-info">
            <textarea
              ref={textareaRef}
              rows={1}
              aria-label="聊天消息"
              value={text}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={chatMode === 'work' ? '把工作交给她…' : '和姐妹说点什么...'}
              disabled={disabled}
              className="min-h-11 w-full resize-none rounded-2xl bg-transparent px-4 py-3 text-sm text-text-primary outline-none placeholder:text-text-muted"
            />
          </div>
        </div>

        <button
          type="button"
          aria-label={voice.state === 'recording' ? '停止录音' : '语音输入'}
          aria-pressed={voice.state === 'recording'}
          onClick={voice.toggle}
          disabled={disabled || voice.state === 'transcribing'}
          className={`flex h-11 w-11 items-center justify-center rounded-2xl shadow-card transition-all active:scale-95 disabled:opacity-40 ${
            voice.state === 'recording'
              ? 'animate-pulse bg-pastel-blush text-danger'
              : 'bg-surface-input text-text-secondary'
          }`}
        >
          {voice.state === 'transcribing' ? <Spinner /> : voice.state === 'recording' ? <Square size={16} /> : <Mic size={18} />}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          aria-label="选择照片"
          className="hidden"
          onChange={handleImagePicked}
        />
        <button
          type="button"
          aria-label="添加照片"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-input text-text-secondary shadow-card transition-all active:scale-95 disabled:opacity-40"
        >
          <ImagePlus size={18} />
        </button>

        <button
          type="button"
          aria-label="发送消息"
          onClick={handleSend}
          disabled={disabled || (!text.trim() && !image)}
          className="flex h-11 w-11 items-center justify-center rounded-2xl bg-action-primary text-text-inverse shadow-card transition-all active:scale-95 disabled:opacity-40"
        >
          <Send size={18} className="ml-0.5" />
        </button>
      </div>
      {(voice.error || imageError) && <p role="alert" className="mt-1.5 px-1 text-xs text-danger">{voice.error || imageError}</p>}
    </div>
  )
}
