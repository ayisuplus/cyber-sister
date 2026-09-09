import { useEffect } from 'react'
import { useChatStore } from '../../stores/chatStore'
import ConversationList from './ConversationList'

// 全端唯一侧边栏（>=641px）：品牌 + 会话列表，不再承担页面导航
export default function AppSidebar() {
  // 侧边栏全局常驻（/profile 等非聊天页也在）：会话列表的加载收口到这里，
  // 保证直达非聊天页时侧边栏依然有会话可点
  const loadConversations = useChatStore(s => s.loadConversations)
  useEffect(() => { loadConversations() }, [loadConversations])

  return (
    <aside className="app-sidebar" aria-label="会话">
      <div className="app-sidebar-brand">
        <span className="app-sidebar-logo" aria-hidden="true">赛</span>
        <span className="display-serif app-sidebar-name">Amie</span>
      </div>
      <ConversationList />
      <p className="app-sidebar-foot">AI 闺蜜 · 内测版</p>
    </aside>
  )
}
