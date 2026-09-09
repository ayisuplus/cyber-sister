import ConversationList from '../layout/ConversationList'

// 移动端（<641px）会话抽屉：ChatHeader 汉堡触发；选中/新建会话后自动关闭
export default function ConversationDrawer({ open, onClose }) {
  if (!open) return null
  return (
    <div className="absolute inset-0 z-50 min-[641px]:hidden" role="dialog" aria-modal="true" aria-label="会话列表抽屉">
      <button type="button" aria-label="关闭会话列表" onClick={onClose} className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-surface-card shadow-xl">
        <ConversationList onNavigate={onClose} />
      </div>
    </div>
  )
}
