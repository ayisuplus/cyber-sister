import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'

export default function Header({ title, showBack = false, rightAction = null }) {
  const navigate = useNavigate()

  return (
    <div className="flex items-center justify-between px-4 h-14 bg-surface-card border-b border-border-hairline shrink-0">
      <div className="w-10">
        {showBack && (
          <button type="button" aria-label="返回上一页" onClick={() => navigate(-1)} className="flex h-11 w-11 items-center justify-center rounded-xl">
            <ChevronLeft size={24} className="text-text-primary" />
          </button>
        )}
      </div>
      <h1 className="display-serif text-lg font-semibold text-text-primary">{title}</h1>
      <div className="w-10 flex justify-end">
        {rightAction}
      </div>
    </div>
  )
}
