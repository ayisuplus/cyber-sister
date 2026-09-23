import BrandMark from '../ui/BrandMark'
import AppNav from './AppNav'

// 全端唯一侧边栏（>=641px）：品牌 + 页面导航。只有一段对话，不再有会话列表。
export default function AppSidebar() {
  return (
    <aside className="app-sidebar" aria-label="侧栏">
      <div className="app-sidebar-brand">
        <BrandMark />
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <AppNav />
      </div>
      <p className="app-sidebar-foot">AI 闺蜜 · 内测版</p>
    </aside>
  )
}
