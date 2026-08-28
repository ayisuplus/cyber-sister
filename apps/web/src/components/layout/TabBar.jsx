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
    label: '工具'
  },
  {
    path: '/profile',
    icon: User,
    label: '我的'
  },
]

export default function TabBar() {
  const location = useLocation()
  const navigate = useNavigate()

  // Sub-pages hide TabBar
  const hidePaths = ['/tools/period', '/tools/todo', '/tools/countdown', '/profile/memories', '/membership', '/settings']
  if (hidePaths.some(p => location.pathname.startsWith(p))) return null

  return (
    <div
      className="flex items-center bg-white safe-area-bottom"
      style={{
        borderTop: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-input)',
        flexShrink: 0
      }}
    >
      {tabs.map(tab => {
        const isActive = location.pathname.startsWith(tab.path)
        const Icon = tab.icon
        return (
          <button
            key={tab.path}
            onClick={() => navigate(tab.path)}
            className="flex-1 flex flex-col items-center py-2.5 gap-1 relative transition-all active:scale-95"
            style={{ transition: 'var(--transition-fast)' }}
          >
            {/* Active indicator */}
            {isActive && (
              <div
                className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-0.5 rounded-full"
                style={{ background: 'var(--gradient-pink)' }}
              />
            )}

            {/* Icon */}
            <div className={`relative ${isActive ? 'scale-110' : ''}`} style={{ transition: 'var(--transition-normal)' }}>
              <Icon
                size={22}
                style={{
                  color: isActive ? 'var(--color-primary)' : 'var(--text-muted)',
                  transition: 'var(--transition-fast)'
                }}
                strokeWidth={isActive ? 2.5 : 1.8}
              />

              {/* Chat notification dot */}
              {tab.path === '/chat' && (
                <div
                  className="absolute -top-1 -right-1 w-2 h-2 rounded-full"
                  style={{ background: 'var(--color-error)' }}
                />
              )}
            </div>

            {/* Label */}
            <span
              className="text-[10px] font-medium"
              style={{
                color: isActive ? 'var(--color-primary)' : 'var(--text-muted)',
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
