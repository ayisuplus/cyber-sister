import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ImagePlus, Mic, Send, Square, X, Paperclip } from 'lucide-react'
import Spinner from '../ui/Spinner'
import { appendTranscript, MAX_RECORD_MS, useVoiceInput } from './useVoiceInput'
import { prepareChatImage } from '../../features/chat/imageResize'
import { isLocalWorkClient } from '../../features/distribution'

// 自动增高，上限 120px，超出出滚动条
const fitHeight = (el) => {
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  el.style.overflowY = el.scrollHeight > 120 ? 'auto' : 'hidden'
}

// 录音中的那一行字：在听多久了；最后 10 秒改成倒数
const recordingLabel = (elapsedMs) => {
  const remaining = Math.ceil((MAX_RECORD_MS - elapsedMs) / 1000)
  if (remaining <= 10) return `还能说 ${Math.max(remaining, 0)} 秒`
  const seconds = Math.floor(elapsedMs / 1000)
  return `在听 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

// 五根细音量条，中间高两边低，跟着她的声音起伏
const BAR_WEIGHTS = [0.55, 0.8, 1, 0.8, 0.55]
function LevelBars({ level }) {
  return (
    <span className="flex h-4 items-center gap-[3px]">
      {BAR_WEIGHTS.map((weight, index) => (
        <span
          key={index}
          className="w-[3px] rounded-full bg-action-primary opacity-70 motion-safe:transition-[height] motion-safe:duration-100"
          style={{ height: `${4 + Math.round(level * weight * 12)}px` }}
        />
      ))}
    </span>
  )
}

// 录音中那一行只给眼睛看（读屏靠按钮的「停止录音」）；小声提示与到点提示放在读屏会播报的 status 里
function VoiceStatus({ voice, hasText }) {
  const recording = voice.state === 'recording'
  return (
    <>
      {recording && (
        <div aria-hidden="true" className="mt-1.5 flex items-center gap-2 px-2 text-xs text-text-secondary">
          {voice.level !== null && <LevelBars level={voice.level} />}
          <span className="tabular-nums">{recordingLabel(voice.elapsedMs)}</span>
        </div>
      )}
      <div role="status" className="px-2 text-xs text-text-secondary">
        {recording && voice.quiet && <p className="mt-1.5">还没听到声音，可以靠近一点说</p>}
        {voice.notice && hasText && <p className="mt-1.5">{voice.notice}</p>}
      </div>
    </>
  )
}

// ref.fillDraft(text)：开场区的敏感话题只填成草稿——输入框已有文字或图片时不覆盖，也从不自动发送。
// onDraftChange(hasDraft)：把"是否已有草稿"告诉聊天页，开场区据此置灰草稿类话题。
// 只有一种对话：附文件只在本地客户端出现；「后台执行」只在聊天页传入 onBackgroundSend（本地且已启用）时出现。
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
  const canAttach = isLocalWorkClient()
  const fitAfterVoiceRef = useRef(false)
  const voice = useVoiceInput((transcript) => {
    fitAfterVoiceRef.current = true
    setText(prev => appendTranscript(prev, transcript))
  }, true)

  const hasDraft = Boolean(text.trim() || image)
  useEffect(() => { onDraftChange?.(hasDraft) }, [hasDraft, onDraftChange])

  // 转写填进来后按内容长高，好让她看完再发；不自动聚焦，免得手机上弹出键盘挡住刚转出来的字
  useEffect(() => {
    if (!fitAfterVoiceRef.current || !textareaRef.current) return
    fitAfterVoiceRef.current = false
    fitHeight(textareaRef.current)
  }, [text])

  // 书写行清空了（发出去或删掉），到点提示跟着收起，不会在下一句话下面又冒出来
  const { clearNotice } = voice
  useEffect(() => { if (!text.trim()) clearNotice() }, [text, clearNotice])

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
    const workFiles = canAttach ? files : []
    if ((text.trim() === '' && !image && !workFiles.length) || disabled) return
    const send = background && onBackgroundSend ? onBackgroundSend : onSend
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
      <div className="chat-input__inner mx-auto w-full max-w-[880px] px-3 pb-3 pt-1 min-[641px]:px-5 min-[641px]:pb-5">
        {onBackgroundSend && <label className="mb-2 flex min-h-11 cursor-pointer items-center gap-2 text-xs text-text-secondary">
          <input type="checkbox" checked={background} disabled={disabled || Boolean(image)} onChange={(event) => setBackground(event.target.checked)} />
          后台执行 <span className="text-text-muted">关闭页面后继续，稍后查看结果</span>
        </label>}
        {canAttach && files.length > 0 && <ul aria-label="待发送文件" className="mb-2 space-y-1 px-1 text-xs text-text-secondary">
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
            placeholder="写下想说的…"
            disabled={disabled}
            className="min-h-11 min-w-0 flex-1 resize-none bg-transparent px-3.5 py-2.5 text-[15px] leading-6 text-text-primary outline-none placeholder:text-text-muted"
          />

          {/* 没配语音服务就不放麦克风，不假装可用 */}
          {voice.configured === true && (
            <button
              type="button"
              aria-label={voice.state === 'recording' ? '停止录音' : '语音输入'}
              aria-pressed={voice.state === 'recording'}
              onClick={voice.toggle}
              disabled={disabled || voice.state === 'transcribing'}
              className={voice.state === 'recording' ? `${ghostButton} record-breath bg-pastel-blush text-danger hover:bg-pastel-blush` : ghostButton}
            >
              {voice.state === 'transcribing' ? <Spinner /> : voice.state === 'recording' ? <Square size={16} /> : <Mic size={18} />}
            </button>
          )}

          {canAttach && <>
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
            disabled={disabled || (background && Boolean(onBackgroundSend))}
            className={ghostButton}
          >
            <ImagePlus size={18} />
          </button>

          <button
            type="button"
            aria-label="发送消息"
            onClick={handleSend}
            disabled={disabled || (!text.trim() && !image && !(canAttach && files.length))}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-action-primary text-text-inverse shadow-button transition-[background-color,box-shadow,opacity,transform] duration-300 ease-calm hover:bg-action-hover active:scale-95 disabled:opacity-40 disabled:shadow-none"
          >
            <Send size={17} className="-ml-0.5 mt-0.5" />
          </button>
        </div>
        <VoiceStatus voice={voice} hasText={Boolean(text.trim())} />
        {(voice.error || imageError || fileError) && <p role="alert" className="mt-1.5 px-2 text-xs text-danger">{voice.error || imageError || fileError}</p>}
      </div>
    </div>
  )
})

export default InputBar
