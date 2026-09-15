export default function TypingIndicator() {
  return (
    <div className="flex animate-settle gap-2.5" role="status" aria-label="Amie 正在输入">
      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-pastel-mist shadow-soft ring-1 ring-border-hairline">
        <img src="/design-assets/ai-avatar-v2.png" alt="" className="h-full w-full object-cover" />
      </div>
      {/* 三个点像呼吸一样依次明暗，不上下跳 */}
      <div className="flex items-center rounded-[24px] rounded-bl-lg bg-bubble-ai px-5 py-4 shadow-soft">
        <div className="flex gap-1.5">
          <div className="typing-dot h-1.5 w-1.5 rounded-full bg-action-primary" />
          <div className="typing-dot h-1.5 w-1.5 rounded-full bg-action-primary" />
          <div className="typing-dot h-1.5 w-1.5 rounded-full bg-action-primary" />
        </div>
      </div>
    </div>
  )
}
