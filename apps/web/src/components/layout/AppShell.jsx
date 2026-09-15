import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { useAppearanceStore } from '../../stores/appearanceStore'
import useGlobalShortcuts from '../../hooks/useGlobalShortcuts'
import ShortcutHelpModal from '../chat/ShortcutHelpModal'
import AmbientMist from '../ui/AmbientMist'
import AppSidebar from './AppSidebar'

/**
 * AppShell — 响应式应用外壳
 *
 * 手机（<=640px）：全屏单列，会话经聊天页抽屉
 * 平板/桌面（>640px）：左侧会话栏 + 居中宽内容区（不再是手机模拟器）
 * 裸路由（/login）：无侧栏，居中卡片 + 晨雾底
 * 自定义主页背景：铺满 main，叠加层保证文字可读；未设置时由晨雾环境光铺底
 */
const BARE_PREFIXES = ['/login']

export default function AppShell({ children }) {
  const location = useLocation()
  const bare = BARE_PREFIXES.some((prefix) => location.pathname.startsWith(prefix))
  const isLoggedIn = useAuthStore(s => s.isLoggedIn)
  const homeBgUrl = useAppearanceStore(s => s.homeBgUrl)
  const loadAppearance = useAppearanceStore(s => s.loadAppearance)
  const { helpOpen, closeHelp } = useGlobalShortcuts()

  // 裸路由（登录页）不探测，避免 401 触发刷新链路
  useEffect(() => {
    if (isLoggedIn && !bare) loadAppearance()
  }, [isLoggedIn, bare, loadAppearance])

  if (bare) {
    return <div className="app-shell-bare"><AmbientMist />{children}</div>
  }

  return (
    <div className="app-shell">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface-card focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-action-primary focus:shadow-card">
        跳到主内容
      </a>
      <AppSidebar />
      <main
        id="main"
        className="app-main"
        style={homeBgUrl ? { backgroundImage: `url(${homeBgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      >
        {homeBgUrl ? <div className="app-bg-overlay" aria-hidden="true" /> : <AmbientMist />}
        {children}
      </main>
      <ShortcutHelpModal open={helpOpen} onClose={closeHelp} />
    </div>
  )
}
