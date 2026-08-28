export default function MessageBubble({ message, isLast }) {
  const isUser = message.role === 'user'
  const emotion = message.emotion

  // 情绪对应的微妙色彩变化
  const getEmotionAccent = () => {
    if (isUser) return {}
    switch (emotion) {
      case 'happy': return { borderLeft: '3px solid #10B981' }
      case 'angry': return { borderLeft: '3px solid #EF4444' }
      case 'sad': return { borderLeft: '3px solid #6B8AFF' }
      case 'anxious': return { borderLeft: '3px solid #FFCB47' }
      default: return {}
    }
  }

  return (
    <div 
      className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
      style={{ 
        animation: 'fadeIn 0.3s ease-out',
        animationFillMode: 'both'
      }}
    >
      {/* AI头像 */}
      {!isUser && (
        <div className="w-8 h-8 rounded-xl overflow-hidden shrink-0 shadow-sm">
          <img 
            src="/design-assets/ai-avatar.png" 
            alt="AI" 
            className="w-full h-full object-cover"
            onError={(e) => {
              e.target.style.display = 'none'
              e.target.parentElement.style.background = 'linear-gradient(135deg, #FF6B9D, #B5A6FF)'
              e.target.parentElement.innerHTML = '<span class="text-white text-xs font-bold flex items-center justify-center h-full">赛</span>'
            }}
          />
        </div>
      )}

      {/* 气泡 */}
      <div
        className={`max-w-[260px] px-4 py-3 ${
          isUser
            ? 'text-white rounded-2xl rounded-br-md'
            : 'bg-white text-[#1A1A2E] rounded-2xl rounded-bl-md'
        }`}
        style={{
          ...(isUser 
            ? { background: 'linear-gradient(135deg, #FF6B9D 0%, #F273B3 100%)' }
            : { 
                boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                ...getEmotionAccent()
              }
          )
        }}
      >
        <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
        
        {/* 时间戳 - 仅最后一条消息显示 */}
        {isLast && (
          <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mt-1.5`}>
            <span className={`text-[10px] ${isUser ? 'text-white/70' : 'text-[#B0B0C8]'}`}>
              {new Date(message.createdAt).toLocaleTimeString('zh-CN', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
