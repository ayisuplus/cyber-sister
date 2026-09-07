import { useAuthStore } from '../../stores/authStore'
import { useAuthedImageUrl } from '../../hooks/useAuthedImageUrl'

const EMOTION_ACCENTS = {
  happy: 'border-status-local',
  angry: 'border-danger',
  sad: 'border-status-info',
  anxious: 'border-status-warning',
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
  const source = SOURCE_LABELS[message.source]
  const sourceLabel = source?.label
  const emotionAccent = EMOTION_ACCENTS[message.emotion] || 'border-transparent'
  const toolRuns = !isUser && Array.isArray(message.toolRuns) ? message.toolRuns : []
  // 用户自定义头像：有则镜像 AI 头像显示在气泡外侧，无则不占位
  const avatarUrl = useAuthedImageUrl(useAuthStore(s => s.user?.avatarUrl))

  return (
    <div className={`flex animate-fade-in gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {isUser && avatarUrl && (
        <div className="h-8 w-8 shrink-0 overflow-hidden rounded-xl bg-pastel-blush">
          <img src={avatarUrl} alt="我的头像" className="h-full w-full object-cover" />
        </div>
      )}
      {!isUser && (
        <div className="h-8 w-8 shrink-0 overflow-hidden rounded-xl bg-pastel-mist">
          <img src="/design-assets/ai-avatar.png" alt="赛博姐妹 AI" className="h-full w-full object-cover" />
        </div>
      )}
      <div className="flex max-w-[260px] flex-col min-[1024px]:max-w-[620px]">
        <div className={`border-l-2 px-4 py-3 text-text-primary shadow-card ${isUser ? 'rounded-2xl rounded-br-md border-transparent bg-bubble-user' : `rounded-2xl rounded-bl-md bg-bubble-ai ${emotionAccent}`}`}>
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{renderRichText(message.content)}</p>
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
