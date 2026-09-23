import { lazy, Suspense } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useAuthedImageUrl } from '../../hooks/useAuthedImageUrl'
import WorkProgress from '../work/WorkProgress'
import ArtifactCard from '../work/ArtifactCard'
import WorkSources from '../work/WorkSources'
import ToolTrail from '../chat/ToolTrail'
import { letterDateLabel } from './letterDate'

const WorkAnswer = lazy(() => import('../work/WorkAnswer'))

/** markdown-lite：你写的字只认 **加粗**，其余一律纯文本（不进 HTML，无注入面） */
function renderRichText(text) {
  return String(text).split(/(\*\*[^*]+\*\*)/g).map((part, index) => (
    part.length > 4 && part.startsWith('**') && part.endsWith('**')
      ? <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong>
      : <span key={index}>{part}</span>
  ))
}

const timeLabel = (value) => (value ? new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '')

// 页边的落款：她写「她」；你有头像时是一枚小小的圆形头像，没有就写「你」
function Who({ isUser }) {
  const avatarUrl = useAuthedImageUrl(useAuthStore((state) => state.user?.avatarUrl))
  if (isUser && avatarUrl) {
    return <img src={avatarUrl} alt="我的头像" className="letter-who letter-who--avatar" />
  }
  return <span aria-hidden="true" className="letter-who">{isUser ? '你' : '她'}</span>
}

/**
 * 信纸上的一段：你写的或她回的。不再有气泡——两种墨色、页边一个落款，换了一天写一行日期。
 * @param {{ message: any, isLast?: boolean, showDate?: boolean }} props
 */
export default function LetterEntry({ message, isLast = false, showDate = false }) {
  const isUser = message.role === 'user'
  const toolRuns = !isUser && Array.isArray(message.toolRuns) ? message.toolRuns : []
  const artifacts = [...new Map((message.workArtifacts || toolRuns.filter((run) => run.ok).flatMap((run) => run.artifacts || (run.artifact ? [run.artifact] : []))).map((artifact) => [artifact.id, artifact])).values()]
  // 照片：发送中用本地预览，持久化后按 messageId 走服务端取图（失败 null 不渲染）
  const authedImageUrl = useAuthedImageUrl(!message.imagePreviewUrl && message.imageExt ? `/chat/images/${message.id}` : null)
  const photoUrl = message.imagePreviewUrl || authedImageUrl

  return (
    <article
      data-role={isUser ? 'user' : 'assistant'}
      data-streaming={!isUser && message.streaming ? 'true' : undefined}
      className={`letter-entry ${isUser ? 'letter-entry--you' : 'letter-entry--her'}`}
    >
      {showDate && <p className="letter-date">{letterDateLabel(message.createdAt)}</p>}
      <Who isUser={isUser} />
      <span className="sr-only">{isUser ? '你说：' : '她说：'}</span>
      {photoUrl && (
        <figure className="letter-photo">
          <img src={photoUrl} alt="发出的照片" />
        </figure>
      )}
      {isUser
        ? <p className="letter-text whitespace-pre-wrap">{renderRichText(message.content)}</p>
        : <Suspense fallback={<p className="letter-text whitespace-pre-wrap">{renderRichText(message.content)}</p>}><WorkAnswer content={message.content} /></Suspense>}
      {message.pendingFiles?.map((name, index) => <p key={index} className="letter-pencil break-all">文件：{name}</p>)}
      {!isUser && <WorkProgress progress={message.progress} toolRuns={toolRuns} />}
      {artifacts.map((artifact) => <ArtifactCard key={artifact.id} artifact={artifact} />)}
      {!isUser && <WorkSources toolRuns={toolRuns} progress={message.progress} />}
      {/* 只标例外：退回本地安全模板时如实写明，像一枚小印章 */}
      {!isUser && message.source === 'local_template' && <p><span className="letter-stamp">本地安全模板</span></p>}
      <ToolTrail runs={toolRuns} />
      {isLast && message.createdAt && <p className="letter-time">{timeLabel(message.createdAt)}</p>}
    </article>
  )
}
