import { useEffect, useState } from 'react'

// 她正在写：信纸上她那一段的位置，一枚呼吸的墨点（三个点依次明暗，不上下跳）
export default function TypingIndicator() {
  const [waiting, setWaiting] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setWaiting(true), 10000)
    return () => clearTimeout(timer)
  }, [])
  return (
    <p className="letter-entry letter-typing" role="status" aria-label={waiting ? '正在等待云端回复' : 'Amie 正在输入'}>
      <span aria-hidden="true" className="letter-who">她</span>
      <span aria-hidden="true" className="typing-dot h-1.5 w-1.5 rounded-full" />
      <span aria-hidden="true" className="typing-dot h-1.5 w-1.5 rounded-full" />
      <span aria-hidden="true" className="typing-dot h-1.5 w-1.5 rounded-full" />
      {waiting && <span className="text-xs text-text-muted">正在等云端回复…</span>}
    </p>
  )
}
