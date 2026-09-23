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

// 放进本子的那几行在信笺上往上飘一点、淡去（样式在 globals.css「信笺」）；比动画略长一点再撤掉，信笺这时才收回一行高
const HAND_OVER_MS = 520
const prefersReducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)

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

// 录音中那一行只给眼睛看（读屏靠按钮的「停止录音」）；小声提示、到点提示与「等她写完」放在读屏会播报的 status 里
function SlipStatus({ voice, hasText, waiting }) {
  const recording = voice.state === 'recording'
  return (
    <>
      {recording && (
        <div aria-hidden="true" className="chat-slip__status mt-1.5 flex items-center gap-2">
          {voice.level !== null && <LevelBars level={voice.level} />}
          <span className="tabular-nums">{recordingLabel(voice.elapsedMs)}</span>
        </div>
      )}
      <div role="status" className="chat-slip__status">
        {recording && voice.quiet && <p className="mt-1.5">还没听到声音，可以靠近一点说</p>}
        {voice.notice && hasText && <p className="mt-1.5">{voice.notice}</p>}
        {waiting && <p className="mt-1.5">她写完这一段，就能放进本子</p>}
      </div>
    </>
  )
}

// 没配语音服务就不放麦克风，不假装可用
function VoiceButton({ voice, disabled }) {
  if (voice.configured !== true) return null
  const recording = voice.state === 'recording'
  const transcribing = voice.state === 'transcribing'
  return (
    <button
      type="button"
      aria-label={recording ? '停止录音' : '语音输入'}
      aria-pressed={recording}
      onClick={voice.toggle}
      disabled={disabled || transcribing}
      className={recording ? 'chat-slip__tool record-breath' : 'chat-slip__tool'}
    >
      {transcribing ? <Spinner /> : recording ? <Square size={16} /> : <Mic size={18} />}
    </button>
  )
}

// 信笺上方还没放进本子的东西：「后台执行」的勾选（本地且已启用时）、待发的文件（本地客户端）、待发的照片
function SlipAttachments({ onBackgroundSend, background, onBackgroundChange, disabled, files, onRemoveFile, image, onRemoveImage }) {
  return (
    <>
      {onBackgroundSend && <label className="mb-2 flex min-h-11 cursor-pointer items-center gap-2 text-xs text-text-secondary">
        <input type="checkbox" checked={background} disabled={disabled || Boolean(image)} onChange={(event) => onBackgroundChange(event.target.checked)} />
        后台执行 <span className="text-text-muted">关闭页面后继续，稍后查看结果</span>
      </label>}
      {files.length > 0 && <ul aria-label="待发送文件" className="mb-2 space-y-1 text-xs text-text-secondary">
        {files.map((file, index) => <li key={`${file.name}-${index}`} className="flex items-center gap-1">
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <button type="button" aria-label={`移除文件 ${file.name}`} disabled={disabled} className="flex h-11 w-11 items-center justify-center" onClick={() => onRemoveFile(index)}><X size={14} /></button>
        </li>)}
      </ul>}
      {image && (
        <div className="mb-2 flex animate-fade-in items-center gap-2">
          {/* 像本子里贴的小相片：白边、歪一点 */}
          <img src={image.previewUrl} alt="待发送的照片预览" className="chat-slip__photo" />
          <button
            type="button"
            aria-label="移除照片"
            onClick={onRemoveImage}
            className="-my-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-secondary"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-card shadow-soft">
              <X size={14} />
            </span>
          </button>
        </div>
      )}
    </>
  )
}

// 本子下面的那张小信笺：先写在这里，点发送，字才离开信笺、落进本子（路线图 C20）。
// ref.fillDraft(text)：开场区的敏感话题只填成草稿——输入框已有文字或图片时不覆盖，也从不自动发送。
// onDraftChange(hasDraft)：把"是否已有草稿"告诉聊天页，开场区据此置灰草稿类话题。
// busy：她正在回。信笺照样能写、能说，只是等她写完这一段才放得进本子。
// 只有一种对话：附文件只在本地客户端出现；「后台执行」只在聊天页传入 onBackgroundSend（本地且已启用）时出现。
/**
 * @typedef {{ onSend: (text: string, options?: object) => Promise<boolean> | boolean, onBackgroundSend?: (text: string, options?: object) => Promise<boolean> | boolean, disabled?: boolean, busy?: boolean, onDraftChange?: (hasDraft: boolean) => void }} InputBarProps
 * @typedef {{ fillDraft: (draft: string) => boolean }} InputBarHandle
 */
const InputBar = forwardRef(/** @param {InputBarProps} props @param {import('react').ForwardedRef<InputBarHandle>} ref */ function InputBar({ onSend, onBackgroundSend, disabled, busy = false, onDraftChange }, ref) {
  const [text, setText] = useState('')
  const [image, setImage] = useState(null) // null | { blob, previewUrl }
  const [imageError, setImageError] = useState('')
  const [files, setFiles] = useState([])
  const [fileError, setFileError] = useState('')
  const [background, setBackground] = useState(false)
  // 刚放进本子的那几行：在信笺上淡去（只给眼睛看）
  const [handedOver, setHandedOver] = useState(null)
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const documentInputRef = useRef(null)
  const canAttach = isLocalWorkClient()
  // 字不是敲进来的（转写、没放进本子又放回来）：按内容重新量一次高度
  const refitRef = useRef(false)
  const voice = useVoiceInput((transcript) => {
    refitRef.current = true
    setText(prev => appendTranscript(prev, transcript))
  }, true)

  const hasDraft = Boolean(text.trim() || image)
  useEffect(() => { onDraftChange?.(hasDraft) }, [hasDraft, onDraftChange])

  // 转写填进来后按内容长高，好让她看完再发；不自动聚焦，免得手机上弹出键盘挡住刚转出来的字
  useEffect(() => {
    if (!refitRef.current || !textareaRef.current) return
    refitRef.current = false
    fitHeight(textareaRef.current)
  }, [text])

  useEffect(() => {
    if (!handedOver) return undefined
    const timer = setTimeout(() => {
      setHandedOver(null)
      // 字淡完了，空出来的信笺再收回一行高（这期间又写了字的，敲字时已经量过）
      const el = textareaRef.current
      if (el && !el.value) fitHeight(el)
    }, HAND_OVER_MS)
    return () => clearTimeout(timer)
  }, [handedOver])

  // 信笺清空了（放进本子或删掉），到点提示跟着收起，不会在下一句话下面又冒出来
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

  const workFiles = canAttach ? files : []
  const hasSomething = Boolean(text.trim() || image || workFiles.length)

  // 没放进本子（发送失败或被作废）：原样放回信笺；这期间又写了字，就接在放回来的那段后面，一个字都不丢
  const putBack = (draft) => {
    refitRef.current = true
    // 还在淡去的那几行不再播：字直接回到原处，不叠出两层
    setHandedOver(null)
    setText((current) => {
      if (!draft.text) return current
      return current.trim() ? `${draft.text}\n${current}` : draft.text
    })
    setImage((current) => current ?? draft.image)
    setFiles((current) => (current.length ? current : draft.files))
  }

  const handleSend = async () => {
    if (!hasSomething || disabled || busy) return
    const send = background && onBackgroundSend ? onBackgroundSend : onSend
    // 点下去，字就离开信笺、落进本子（本子那边由聊天页马上写上这一段）；
    // 信笺先保持原来的高度，让那几行在原处淡去，淡完再收回一行高
    const draft = { text, image, files }
    setText('')
    setImage(null)
    setFiles([])
    setFileError('')
    if (text.trim() && !prefersReducedMotion()) setHandedOver({ key: Date.now(), text: text.trim() })
    else if (textareaRef.current) textareaRef.current.style.height = 'auto'
    const sent = await send(text.trim(), { image, ...(workFiles.length ? { files: workFiles } : {}) })
    if (!sent) putBack(draft)
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

  const alert = voice.error || imageError || fileError

  return (
    <div className="chat-slip safe-area-bottom">
      <div className="chat-slip__paper">
        <SlipAttachments
          onBackgroundSend={onBackgroundSend}
          background={background}
          onBackgroundChange={setBackground}
          disabled={disabled}
          files={workFiles}
          onRemoveFile={(index) => setFiles((current) => current.filter((_, i) => i !== index))}
          image={image}
          onRemoveImage={removeImage}
        />

        {/* 一行：左边写字，右边几个铅笔灰的小图标，最右是那枚墨章；写字时整张信笺亮起焦点环 */}
        <div className="chat-slip__row">
          <div className="chat-slip__field">
            <textarea
              ref={textareaRef}
              rows={1}
              aria-label="聊天消息"
              value={text}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder="写下想说的…"
              disabled={disabled}
              className={handedOver ? 'chat-slip__text chat-slip__text--handing' : 'chat-slip__text'}
            />
            {handedOver && <p key={handedOver.key} aria-hidden="true" className="chat-slip__handed">{handedOver.text}</p>}
          </div>

          <VoiceButton voice={voice} disabled={disabled} />

          {canAttach && <>
            <input ref={documentInputRef} type="file" multiple accept=".pdf,.xlsx,.docx,.pptx,.txt,.md,.csv,.json,.js,.py,.html,.png,.jpg" aria-label="选择工作文件" className="hidden" onChange={handleFilesPicked} />
            <button type="button" aria-label="添加文件" onClick={() => documentInputRef.current?.click()} disabled={disabled} className="chat-slip__tool"><Paperclip size={18} /></button>
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
            className="chat-slip__tool"
          >
            <ImagePlus size={18} />
          </button>

          {/* 发送是一枚小墨章：空着时只是一圈铅笔印，写了字就蘸满墨；她还在写时先不盖 */}
          <button
            type="button"
            aria-label="发送消息"
            onClick={handleSend}
            disabled={disabled || busy || !hasSomething}
            className="chat-slip__send"
          >
            <Send size={17} className="-ml-0.5 mt-0.5" />
          </button>
        </div>
        <SlipStatus voice={voice} hasText={Boolean(text.trim())} waiting={busy && hasSomething} />
        {alert && <p role="alert" className="mt-1.5 text-xs text-danger">{alert}</p>}
      </div>
    </div>
  )
})

export default InputBar
