import { useState } from 'react'
import { format, isSameDay } from 'date-fns'
import { Plus, Trash2 } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import Button from '../ui/Button'
import ConfirmDialog from '../ui/ConfirmDialog'

// 桌面端会话侧栏（>=1024px 显示）：列表 / 切换 / 新建 / 删除。
// 会话条目含标题、最近一条消息摘要与更新时间；删除走应用内确认弹窗。
const formatTime = (iso) => {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return isSameDay(date, new Date()) ? format(date, 'HH:mm') : format(date, 'M月d日')
}

export default function ConversationPanel() {
  const conversations = useChatStore(state => state.conversations)
  const chatMode = useChatStore(state => state.chatMode)
  const currentConversationId = useChatStore(state => state.currentConversationId)
  const setCurrentConversation = useChatStore(state => state.setCurrentConversation)
  const createConversation = useChatStore(state => state.createConversation)
  const deleteConversation = useChatStore(state => state.deleteConversation)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    if (creating) return
    setCreating(true)
    try {
      await createConversation()
    } catch {
      // 新建失败保持现状，列表不变
    } finally {
      setCreating(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return
    try {
      await deleteConversation(pendingDelete.id)
    } catch {
      // 删除失败保持现状，列表不变
    }
    setPendingDelete(null)
  }

  const visibleConversations = conversations.filter(c => (c.mode || 'chat') === chatMode)

  return (
    <aside className="relative hidden w-64 shrink-0 flex-col border-r border-border-hairline bg-surface-card min-[1024px]:flex" aria-label="会话列表">
      <div className="border-b border-border-hairline px-4 py-3">
        <h2 className="display-serif text-sm font-semibold text-text-primary">会话</h2>
      </div>

      <nav className="scrollbar-hide flex-1 space-y-1 overflow-y-auto p-2">
        {visibleConversations.length === 0 && (
          <p className="px-3 py-8 text-center text-xs text-text-muted">{chatMode === 'work' ? '还没有工作会话，发一条就开始' : '还没有会话，从下方新建一个吧'}</p>
        )}
        {visibleConversations.map((conversation) => {
          const active = conversation.id === currentConversationId
          const title = conversation.title || '新会话'
          const preview = conversation.messages?.[0]?.content || ''
          return (
            <div key={conversation.id} className={`flex items-center rounded-control transition-colors ${active ? 'bg-pastel-blush' : 'hover:bg-surface-muted'}`}>
              <button
                type="button"
                onClick={() => { if (!active) setCurrentConversation(conversation.id) }}
                aria-current={active ? 'true' : undefined}
                className={`flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2 text-left ${active ? 'text-action-primary' : 'text-text-secondary'}`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`truncate text-sm ${active ? 'font-semibold' : ''}`}>{title}</span>
                  <span className="shrink-0 text-[10px] text-text-muted">{formatTime(conversation.updatedAt)}</span>
                </span>
                <span className="truncate text-[11px] text-text-muted">{preview || '暂无消息'}</span>
              </button>
              <button
                type="button"
                aria-label={`删除会话 ${title}`}
                onClick={() => setPendingDelete(conversation)}
                className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-pastel-blush hover:text-danger"
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          )
        })}
      </nav>

      <div className="border-t border-border-hairline p-3">
        <Button className="w-full" onClick={handleCreate} disabled={creating}>
          <Plus size={16} aria-hidden="true" />
          新会话
        </Button>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除会话"
        description="删除后该会话的聊天记录无法恢复，确定继续吗？"
        confirmLabel="确认删除"
        danger
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </aside>
  )
}
