import { Sparkles } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'

import { getPersona } from '../../features/personas'

export default function ChatHeader() {
  const user = useAuthStore(state => state.user)
  const personaInfo = getPersona(user?.persona)

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
          <div className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl bg-pastel-blush text-lg font-bold text-action-primary shadow-card">
            <span aria-hidden="true">赛</span>
            <img src="/design-assets/ai-avatar.png" alt="赛博姐妹 AI" className="absolute inset-0 h-full w-full object-cover" onError={event => { event.currentTarget.style.display = 'none' }} />
          </div>

          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold text-text-primary">赛博姐妹</h2>
              <span className="text-xs" aria-hidden="true">{personaInfo.emoji}</span>
            </div>
            <span className={`mt-0.5 inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${personaInfo.chatBadgeClass}`}>
              {personaInfo.chatTag}
            </span>
          </div>
        </div>

        <span className="rounded-full bg-pastel-sprout px-3 py-1.5 text-[10px] font-medium text-status-local">AI 生成 · 本地优先</span>
      </div>
    </>
  )
}
