const EMOTION_ACCENTS = {
  happy: 'border-status-local',
  angry: 'border-danger',
  sad: 'border-status-info',
  anxious: 'border-status-warning',
}

const SOURCE_LABELS = {
  local_model: { label: '本机模型', className: 'bg-pastel-sprout text-status-local' },
  qwen: { label: '云端备用', className: 'bg-pastel-mist text-status-info' },
  local_template: { label: '本地安全模板', className: 'bg-pastel-apricot text-text-secondary' },
}

export default function MessageBubble({ message, isLast }) {
  const isUser = message.role === 'user'
  const source = SOURCE_LABELS[message.source]
  const emotionAccent = EMOTION_ACCENTS[message.emotion] || 'border-transparent'

  return (
    <div className={`flex animate-fade-in gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isUser && (
        <div className="h-8 w-8 shrink-0 overflow-hidden rounded-xl bg-pastel-mist">
          <img src="/design-assets/ai-avatar.png" alt="赛博姐妹 AI" className="h-full w-full object-cover" />
        </div>
      )}

      <div className={`max-w-[260px] border-l-2 px-4 py-3 text-text-primary ${isUser ? 'rounded-2xl rounded-br-md border-transparent bg-pastel-blush' : `rounded-2xl rounded-bl-md bg-pastel-mist ${emotionAccent}`}`}>
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{message.content}</p>
        {!isUser && source && (
          <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${source.className}`}>{source.label}</span>
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
    </div>
  )
}
