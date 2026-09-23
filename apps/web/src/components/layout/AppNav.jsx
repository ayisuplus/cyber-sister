import { NavLink } from 'react-router-dom'
import { MessageCircle, Settings } from 'lucide-react'
import { ENTRIES } from '../../features/registry'

// 全端唯一的页面导航（侧栏与手机抽屉共用）：对话 + 注册表里的入口 + 设置，一列排下来。
const ITEMS = [
  { id: 'chat', title: '对话', to: '/chat', icon: MessageCircle },
  ...ENTRIES,
  { id: 'settings', title: '设置', to: '/settings', icon: Settings },
]

/** @param {{ onNavigate?: () => void }} [props] */
export default function AppNav({ onNavigate } = {}) {
  return (
    <nav aria-label="页面导航" className="flex flex-col gap-0.5">
      {ITEMS.map(({ id, title, to, icon: Icon }) => (
        <NavLink
          key={id}
          to={to}
          end={id === 'chat'}
          onClick={onNavigate}
          className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-control px-3 text-sm transition-colors duration-300 ease-calm ${isActive ? 'bg-pastel-blush text-action-primary' : 'text-text-secondary hover:bg-surface-muted'}`}
        >
          <Icon size={17} aria-hidden="true" />
          {title}
        </NavLink>
      ))}
    </nav>
  )
}
