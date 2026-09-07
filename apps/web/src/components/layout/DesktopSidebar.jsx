import { NavLink } from 'react-router-dom'
import { APP_TABS } from './TabBar'

/**
 * 桌面侧边导航（>640px 显示）。导航项与底部 TabBar 共用 APP_TABS。
 */
export default function DesktopSidebar() {
  return (
    <aside className="app-sidebar" aria-label="主导航">
      <div className="app-sidebar-brand">
        <span className="app-sidebar-logo" aria-hidden="true">赛</span>
        <span className="display-serif app-sidebar-name">赛博姐妹</span>
      </div>
      <nav className="app-sidebar-nav">
        {APP_TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <NavLink key={tab.path} to={tab.path} className={({ isActive }) => `app-sidebar-link${isActive ? ' app-sidebar-link-active' : ''}`}>
              <Icon size={18} aria-hidden="true" />
              {tab.label}
            </NavLink>
          )
        })}
      </nav>
      <p className="app-sidebar-foot">AI 闺蜜 · 内测版</p>
    </aside>
  )
}
