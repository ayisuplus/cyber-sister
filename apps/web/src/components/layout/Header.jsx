import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Settings } from 'lucide-react'

export default function Header({ title, showBack = false, rightAction }) {
  const navigate = useNavigate()

  return (
    <div className="flex items-center justify-between px-4 h-14 bg-white shadow-header shrink-0">
      <div className="w-10">
        {showBack && (
          <button onClick={() => navigate(-1)} className="p-1">
            <ChevronLeft size={24} className="text-text-primary" />
          </button>
        )}
      </div>
      <h1 className="text-base font-semibold text-text-primary">{title}</h1>
      <div className="w-10 flex justify-end">
        {rightAction}
      </div>
    </div>
  )
}
