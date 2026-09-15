import { NavLink } from 'react-router-dom'
import { Settings } from 'lucide-react'
import { visibleEntries } from '../../features/registry'
import { isLocalWorkClient } from '../../features/distribution'

// 全端唯一的页面导航：注册表里的入口 + 设置。网页版只显示网页可用的入口。
/** @param {{ onNavigate?: () => void }} [props] */
export default function AppNav({ onNavigate } = {}) {
  const items = [...visibleEntries({ local: isLocalWorkClient() }), { id: 'settings', title: '设置', to: '/settings', icon: Settings }]

  return (
    <nav aria-label="页面导航" className={`mt-2 grid gap-1 ${items.length <= 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
      {items.map(({ id, title, to, icon: Icon }) => (
        <NavLink
          key={id}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) => `flex min-h-14 flex-col items-center justify-center gap-1 rounded-control text-xs transition-colors duration-300 ease-calm ${isActive ? 'bg-pastel-blush text-action-primary' : 'text-text-secondary hover:bg-surface-muted'}`}
        >
          <Icon size={17} aria-hidden="true" />
          {title}
        </NavLink>
      ))}
    </nav>
  )
}
