import { useLocation, useNavigate } from 'react-router-dom'
import { MessageCircle, Wrench, User } from 'lucide-react'

const tabs = [
  {
    path: '/chat',
    icon: MessageCircle,
    label: '聊天'
  },
  {
    path: '/tools',
    icon: Wrench,
    label: '发现'
  },
  {
    path: '/profile',
    icon: User,
    label: '人格与记忆'
  },
]

export default function TabBar() {
  const location = useLocation()
  const navigate = useNavigate()

  // Sub-pages hide TabBar
  const hidePaths = ['/profile/memories', '/profile/local-model', '/tools/virtual-makeup', '/tools/virtual-fitting', '/tools/beauty-camera', '/tools/period', '/tools/countdown', '/tools/todo', '/settings']
  if (hidePaths.some(p => location.pathname.startsWith(p))) return null

  return (
    <div
      className="flex items-center bg-surface-card border-t border-border-hairline safe-area-bottom"
      style={{
        flexShrink: 0
      }}
    >
      {tabs.map(tab => {
        const isActive = location.pathname.startsWith(tab.path)
        const Icon = tab.icon
        return (
          <button
            key={tab.path}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            aria-label={tab.label}
            onClick={() => navigate(tab.path)}
            className={`min-h-14 flex-1 flex flex-col items-center justify-center py-2 gap-1 relative transition-all active:scale-95 ${isActive ? 'text-action-primary' : 'text-text-muted'}`}
            style={{ transition: 'var(--transition-fast)' }}
          >
            {/* Active indicator */}
            {isActive && (
              <div
                className="absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-action-primary"
              />
            )}

            {/* Icon */}
            <div className={`relative ${isActive ? 'scale-110' : ''}`} style={{ transition: 'var(--transition-normal)' }}>
              <Icon
                size={22}
                style={{
                  transition: 'var(--transition-fast)'
                }}
                strokeWidth={isActive ? 2.5 : 1.8}
              />

            </div>

            {/* Label */}
            <span
              className="text-[10px] font-medium"
              style={{
                transition: 'var(--transition-fast)'
              }}
            >
              {tab.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
