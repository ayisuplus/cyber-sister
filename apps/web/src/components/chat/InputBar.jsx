import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ImagePlus, Mic, Send, Square, X, Paperclip } from 'lucide-react'
import Spinner from '../ui/Spinner'
import { useVoiceInput } from './useVoiceInput'
import { useChatStore } from '../../stores/chatStore'
import { prepareChatImage } from '../../features/chat/imageResize'

// 自动增高，上限 120px，超出出滚动条
const fitHeight = (el) => {
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  el.style.overflowY = el.scrollHeight > 120 ? 'auto' : 'hidden'
}

// ref.fillDraft(text)：开场区的敏感话题只填成草稿——输入框已有文字或图片时不覆盖，也从不自动发送。
// onDraftChange(hasDraft)：把"是否已有草稿"告诉聊天页，开场区据此置灰草稿类话题。
/**
 * @typedef {{ onSend: (text: string, options?: object) => Promise<boolean> | boolean, onBackgroundSend?: (text: string, options?: object) => Promise<boolean> | boolean, disabled?: boolean, onDraftChange?: (hasDraft: boolean) => void }} InputBarProps
 * @typedef {{ fillDraft: (draft: string) => boolean }} InputBarHandle
 */
const InputBar = forwardRef(/** @param {InputBarProps} props @param {import('react').ForwardedRef<InputBarHandle>} ref */ function InputBar({ onSend, onBackgroundSend, disabled, onDraftChange }, ref) {
  const [text, setText] = useState('')
  const [image, setImage] = useState(null) // null | { blob, previewUrl }
  const [imageError, setImageError] = useState('')
  const [files, setFiles] = useState([])
  const [fileError, setFileError] = useState('')
  const [background, setBackground] = useState(false)
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const documentInputRef = useRef(null)
  const chatMode = useChatStore(state => state.chatMode)
  const voice = useVoiceInput((transcript) => {
    setText(prev => (prev ? `${prev} ${transcript}` : transcript))
  }, chatMode === 'chat')

  const hasDraft = Boolean(text.trim() || image)
  useEffect(() => { onDraftChange?.(hasDraft) }, [hasDraft, onDraftChange])

  useImperativeHandle(ref, () => ({
    fillDraft(draft) {
      if (hasDraft || disabled) return false
      setText(draft)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        fitHeight(el)
        el.focus()
      })
      return true
    },
  }), [hasDraft, disabled])

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

  const handleFilesPicked = (event) => {
    const selected = [...files, ...Array.from(event.target.files || [])]
    event.target.value = ''
    if (selected.length > 3 || selected.some((file) => !file.size || file.size > 5 * 1024 * 1024)
      || selected.reduce((sum, file) => sum + file.size, 0) > 12 * 1024 * 1024) {
      setFileError('最多 3 个文件，每个 5 MB，总计 12 MB；不能上传空文件')
      return
    }
    setFileError('')
    setFiles(selected)
  }

  const handleSend = async () => {
    const workFiles = chatMode === 'work' ? files : []
    if ((text.trim() === '' && !image && !workFiles.length) || disabled) return
    const send = chatMode === 'work' && background && onBackgroundSend ? onBackgroundSend : onSend
    const sent = await send(text.trim(), { image, ...(workFiles.length ? { files: workFiles } : {}) })
    if (sent) {
      setText('')
      setImage(null)
      setFiles([])
      setFileError('')
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

  const handleChange = (e) => {
    fitHeight(e.target)
    setText(e.target.value)
  }

  // 胶囊内的无底圆形图标按钮（44px 触控）
  const ghostButton = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-secondary transition-[background-color,color,transform] duration-300 ease-calm hover:bg-surface-muted active:scale-95 disabled:opacity-40'

  return (
    <div className="safe-area-bottom relative z-10">
      <div className="mx-auto w-full max-w-[880px] px-3 pb-3 pt-1 min-[641px]:px-5 min-[641px]:pb-5">
        {chatMode === 'work' && onBackgroundSend && <label className="mb-2 flex min-h-11 cursor-pointer items-center gap-2 text-xs text-text-secondary">
          <input type="checkbox" checked={background} disabled={disabled || Boolean(image)} onChange={(event) => setBackground(event.target.checked)} />
          后台执行 <span className="text-text-muted">关闭页面后继续，稍后查看结果</span>
        </label>}
        {chatMode === 'work' && files.length > 0 && <ul aria-label="待发送文件" className="mb-2 space-y-1 px-1 text-xs text-text-secondary">
          {files.map((file, index) => <li key={`${file.name}-${index}`} className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <button type="button" aria-label={`移除文件 ${file.name}`} disabled={disabled} className="flex h-11 w-11 items-center justify-center" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}><X size={14} /></button>
          </li>)}
        </ul>}
        {image && (
          <div className="mb-2 flex animate-fade-in items-center gap-2 px-1">
            <img src={image.previewUrl} alt="待发送的照片预览" className="h-16 w-16 rounded-2xl object-cover shadow-soft" />
            <button
              type="button"
              aria-label="移除照片"
              onClick={removeImage}
              className="-my-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-secondary"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-card shadow-soft">
                <X size={14} />
              </span>
            </button>
          </div>
        )}

        {/* 悬浮输入胶囊：正文框与按钮同在一处，聚焦时整圈亮起焦点环 */}
        <div className="input-capsule glass-strong flex items-end gap-0.5 rounded-[26px] p-1.5">
          <textarea
            ref={textareaRef}
            rows={1}
            aria-label="聊天消息"
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={chatMode === 'work' ? '交给 Amie：研究、写作、计划或整理成文件…' : '和姐妹说点什么...'}
            disabled={disabled}
            className="min-h-11 min-w-0 flex-1 resize-none bg-transparent px-3.5 py-2.5 text-[15px] leading-6 text-text-primary outline-none placeholder:text-text-muted"
          />

          {chatMode === 'chat' && <button
            type="button"
            aria-label={voice.state === 'recording' ? '停止录音' : '语音输入'}
            aria-pressed={voice.state === 'recording'}
            onClick={voice.toggle}
            disabled={disabled || voice.state === 'transcribing'}
            className={voice.state === 'recording' ? `${ghostButton} record-breath bg-pastel-blush text-danger hover:bg-pastel-blush` : ghostButton}
          >
            {voice.state === 'transcribing' ? <Spinner /> : voice.state === 'recording' ? <Square size={16} /> : <Mic size={18} />}
          </button>}

          {chatMode === 'work' && <>
            <input ref={documentInputRef} type="file" multiple accept=".pdf,.xlsx,.docx,.pptx,.txt,.md,.csv,.json,.js,.py,.html,.png,.jpg" aria-label="选择工作文件" className="hidden" onChange={handleFilesPicked} />
            <button type="button" aria-label="添加文件" onClick={() => documentInputRef.current?.click()} disabled={disabled} className={ghostButton}><Paperclip size={18} /></button>
          </>}
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
            disabled={disabled || (chatMode === 'work' && background && Boolean(onBackgroundSend))}
            className={ghostButton}
          >
            <ImagePlus size={18} />
          </button>

          <button
            type="button"
            aria-label="发送消息"
            onClick={handleSend}
            disabled={disabled || (!text.trim() && !image && !(chatMode === 'work' && files.length))}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-action-primary text-text-inverse shadow-button transition-[background-color,box-shadow,opacity,transform] duration-300 ease-calm hover:bg-action-hover active:scale-95 disabled:opacity-40 disabled:shadow-none"
          >
            <Send size={17} className="-ml-0.5 mt-0.5" />
          </button>
        </div>
        {(voice.error || imageError || fileError) && <p role="alert" className="mt-1.5 px-2 text-xs text-danger">{voice.error || imageError || fileError}</p>}
      </div>
    </div>
  )
})

export default InputBar
