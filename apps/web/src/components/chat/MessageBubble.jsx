import { lazy, Suspense } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useAuthedImageUrl } from '../../hooks/useAuthedImageUrl'
import WorkProgress from '../work/WorkProgress'
import ArtifactCard from '../work/ArtifactCard'
import WorkSources from '../work/WorkSources'

const WorkAnswer = lazy(() => import('../work/WorkAnswer'))

const EMOTION_ACCENTS = {
  happy: 'border-l-status-local',
  angry: 'border-l-danger',
  sad: 'border-l-status-info',
  anxious: 'border-l-status-warning',
}

const SOURCE_LABELS = {
  qwen: { label: '云端模型', className: 'bg-pastel-mist text-status-info' },
  local_template: { label: '本地安全模板', className: 'bg-pastel-apricot text-text-secondary' },
}

/** markdown-lite：只渲染 **加粗**，其余一律纯文本（不进 HTML，无注入面） */
function renderRichText(text) {
  return String(text).split(/(\*\*[^*]+\*\*)/g).map((part, index) => (
    part.length > 4 && part.startsWith('**') && part.endsWith('**')
      ? <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong>
      : <span key={index}>{part}</span>
  ))
}


export default function MessageBubble({ message, isLast }) {
  const isUser = message.role === 'user'
  // 只有流式中的临时消息入场：历史由翻页整体承接；done 后持久化消息换 id 重挂载，不应再闪一次
  const isLive = String(message.id).startsWith('temp-')
  const enterClass = isLive ? (isUser ? 'animate-rise' : 'animate-settle') : ''
  const source = SOURCE_LABELS[message.source]
  const sourceLabel = source?.label
  const emotionAccent = EMOTION_ACCENTS[message.emotion] || 'border-l-transparent'
  const toolRuns = !isUser && Array.isArray(message.toolRuns) ? message.toolRuns : []
  const artifacts = [...new Map((message.workArtifacts || toolRuns.filter((run) => run.ok).flatMap((run) => run.artifacts || (run.artifact ? [run.artifact] : []))).map((artifact) => [artifact.id, artifact])).values()]
  // 用户自定义头像：有则镜像 AI 头像显示在气泡外侧，无则不占位
  const avatarUrl = useAuthedImageUrl(useAuthStore(s => s.user?.avatarUrl))
  // 照片消息：发送中用本地预览，持久化后按 messageId 走服务端取图（失败 null 不渲染）
  const authedImageUrl = useAuthedImageUrl(!message.imagePreviewUrl && message.imageExt ? `/chat/images/${message.id}` : null)
  const chatImageUrl = message.imagePreviewUrl || authedImageUrl

  return (
    <div className={`flex gap-2.5 ${enterClass} ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {isUser && avatarUrl && (
        <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-pastel-blush shadow-soft ring-1 ring-border-hairline">
          <img src={avatarUrl} alt="我的头像" className="h-full w-full object-cover" />
        </div>
      )}
      {!isUser && (
        <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-pastel-mist shadow-soft ring-1 ring-border-hairline">
          <img src="/design-assets/ai-avatar-v2.png" alt="Amie AI" className="h-full w-full object-cover" />
        </div>
      )}
      <div className="flex max-w-[80%] flex-col min-[1024px]:max-w-[620px]">
        {/* 无外框的实色气泡；AI 气泡左缘保留 2px 情绪色线 */}
        <div
          data-streaming={!isUser && message.streaming ? 'true' : undefined}
          className={`border-l-2 px-4 py-3 text-text-primary shadow-soft ${isUser ? 'rounded-[24px] rounded-br-lg border-l-transparent bg-bubble-user' : `bubble-ai rounded-[24px] rounded-bl-lg bg-bubble-ai ${emotionAccent}`}`}
        >
          {chatImageUrl && (
            <img src={chatImageUrl} alt="发出的照片" className="mb-2 max-h-64 rounded-2xl object-cover" />
          )}
          {isUser ? <p className="whitespace-pre-wrap text-[15px] leading-[1.75]">{renderRichText(message.content)}</p>
            : <Suspense fallback={<p className="whitespace-pre-wrap text-[15px] leading-[1.75]">{renderRichText(message.content)}</p>}><WorkAnswer content={message.content} /></Suspense>}
          {message.pendingFiles?.map((name, index) => <p key={index} className="mt-2 break-all text-xs text-text-secondary">文件：{name}</p>)}
          {!isUser && <WorkProgress progress={message.progress} toolRuns={toolRuns} />}
          {artifacts.map((artifact) => <ArtifactCard key={artifact.id} artifact={artifact} />)}
          {!isUser && <WorkSources toolRuns={toolRuns} progress={message.progress} />}
          {!isUser && source && (
            <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${source.className}`}>{sourceLabel}</span>
          )}

          {isLast && (
            <div className={`mt-1.5 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <span className="text-[10px] text-text-muted">
                {message.createdAt ? new Date(message.createdAt).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                }) : ''}
              </span>
            </div>
          )}
        </div>

        {toolRuns.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {toolRuns.map((run, index) => (
              <span
                key={`${run.tool}-${index}`}
                aria-label={`${run.ok ? '已执行' : '执行失败'}：${run.summary}`}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${run.ok ? 'bg-pastel-sprout text-status-local' : 'bg-pastel-blush text-danger'}`}
              >
                <span aria-hidden="true">{run.ok ? '✓' : '✗'}</span>
                {run.summary}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
