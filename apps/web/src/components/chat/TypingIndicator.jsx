export default function TypingIndicator() {
  return (
    <div className="flex gap-2 animate-fade-in">
      <div className="w-8 h-8 rounded-full bg-gradient-pink-purple flex items-center justify-center shrink-0">
        <span className="text-text-inverse text-xs font-bold">AI</span>
      </div>
      <div className="bg-surface-card rounded-[16px] rounded-bl-[4px] shadow-card px-4 py-3">
        <div className="flex gap-1">
          <div className="w-2 h-2 bg-text-muted rounded-full typing-dot" />
          <div className="w-2 h-2 bg-text-muted rounded-full typing-dot" />
          <div className="w-2 h-2 bg-text-muted rounded-full typing-dot" />
        </div>
      </div>
    </div>
  )
}
