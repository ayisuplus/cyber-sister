import { LayoutGrid, Menu, Sparkles } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useChatStore } from '../../stores/chatStore'

import { getPersona } from '../../features/personas'

const MODE_OPTIONS = [
  { id: 'chat', label: '聊天' },
  { id: 'work', label: '工作' },
]

export default function ChatHeader({ onOpenDrawer, onOpenWorkbench }) {
  const user = useAuthStore(state => state.user)
  const personaInfo = getPersona(user?.persona)
  const chatMode = useChatStore(state => state.chatMode)
  const setChatMode = useChatStore(state => state.setChatMode)

  return (
    <>
      <div className="flex h-8 shrink-0 items-center justify-center bg-pastel-mist text-xs">
        <span className="flex items-center gap-1.5 text-text-secondary">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-surface-card text-status-info" aria-hidden="true">
            <Sparkles size={10} />
          </span>
          这是 AI，不是真人
        </span>
      </div>

      <div className="flex h-16 shrink-0 items-center justify-between bg-surface-card px-4 border-b border-border-hairline">
        <div className="flex items-center gap-3">
          <button type="button" aria-label="打开会话列表" onClick={onOpenDrawer} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-primary min-[641px]:hidden">
            <Menu size={22} aria-hidden="true" />
          </button>
          <div className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl bg-pastel-blush text-lg font-bold text-action-primary shadow-card">
            <span aria-hidden="true">赛</span>
            <img src="/design-assets/ai-avatar.png" alt="Amie AI" className="absolute inset-0 h-full w-full object-cover" onError={event => { event.currentTarget.style.display = 'none' }} />
          </div>

          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold text-text-primary">Amie</h2>
              {chatMode === 'chat' && <span className="text-xs" aria-hidden="true">{personaInfo.emoji}</span>}
            </div>
            {chatMode === 'work' ? (
              <span className="mt-0.5 inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-pastel-mist text-status-info">
                工作模式
              </span>
            ) : (
              <span className={`mt-0.5 inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${personaInfo.chatBadgeClass}`}>
                {personaInfo.chatTag}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {chatMode === 'work' && (
            <button type="button" aria-label="打开功能桌面" onClick={onOpenWorkbench} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-primary">
              <LayoutGrid size={20} aria-hidden="true" />
            </button>
          )}
          <div role="group" aria-label="会话模式" className="flex rounded-full bg-surface-input p-0.5">
            {MODE_OPTIONS.map(option => {
              const selected = chatMode === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setChatMode(option.id)}
                  className={`min-h-11 rounded-full px-3 text-xs font-medium transition-colors ${selected ? 'bg-action-primary text-text-inverse' : 'text-text-secondary'}`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
          <span className="rounded-full bg-pastel-mist px-3 py-1.5 text-[10px] font-medium text-status-info">AI 生成 · 云端模型</span>
        </div>
      </div>
    </>
  )
}
