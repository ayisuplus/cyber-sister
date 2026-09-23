// 她正在写：信纸上她那一段的位置，一枚呼吸的墨点（三个点依次明暗，不上下跳）
export default function TypingIndicator() {
  return (
    <p className="letter-entry letter-typing" role="status" aria-label="Amie 正在输入">
      <span aria-hidden="true" className="letter-who">她</span>
      <span aria-hidden="true" className="typing-dot h-1.5 w-1.5 rounded-full" />
      <span aria-hidden="true" className="typing-dot h-1.5 w-1.5 rounded-full" />
      <span aria-hidden="true" className="typing-dot h-1.5 w-1.5 rounded-full" />
    </p>
  )
}
