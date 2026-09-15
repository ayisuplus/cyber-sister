import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Header from '../components/layout/Header'
import CompanionStatePanel from '../components/chat/CompanionStatePanel'
import MemoryReviewPanel from '../components/memory/MemoryReviewPanel'
import MemoriesPage from './MemoriesPage'
import { useAuthStore } from '../stores/authStore'
import { SPEAKING_STYLES, getPersona } from '../features/personas'

const MEMORY_TABS = [{ id: 'saved', label: '已记住' }, { id: 'pending', label: '待确认' }, { id: 'relations', label: '关系' }]

// 「她」：她怎么和你说话、她此刻的节奏、她记得的你——关于她的一切都在这一处。
export default function HerPage() {
  const user = useAuthStore(state => state.user)
  const updatePersona = useAuthStore(state => state.updatePersona)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [params, setParams] = useSearchParams()
  const tab = MEMORY_TABS.some(item => item.id === params.get('tab')) ? params.get('tab') : 'saved'
  const current = user?.persona
  const retired = Boolean(current) && !SPEAKING_STYLES.some(style => style.id === current)

  const choose = async (id) => {
    if (saving || id === current) return
    setSaving(true)
    setMessage('')
    try {
      await updatePersona(id)
      setMessage('换好了，下一条消息就用这种方式和你说话')
    } catch {
      setMessage('没换成功，请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header title="她" showBack />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
          <section aria-labelledby="her-style-title" className="rounded-card bg-surface-card p-4 shadow-card">
            <h2 id="her-style-title" className="text-sm font-semibold text-text-primary">她的说话方式</h2>
            {retired && <p className="mt-1 text-xs text-text-muted">你之前选的「{getPersona(current).name}」已经合并了，选一种新的吧。</p>}
            <div className="mt-3 grid grid-cols-3 gap-2">
              {SPEAKING_STYLES.map(style => {
                const active = style.id === current
                return (
                  <button
                    key={style.id}
                    type="button"
                    aria-pressed={active}
                    disabled={saving}
                    onClick={() => choose(style.id)}
                    className={`min-h-[88px] rounded-control border p-3 text-left transition-colors duration-300 ease-calm disabled:opacity-50 ${active ? 'border-action-primary bg-pastel-blush' : 'border-border-subtle bg-surface-card hover:bg-surface-muted'}`}
                  >
                    <span className="block font-display text-base text-text-primary">{style.label}</span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-text-secondary">{style.description}</span>
                  </button>
                )
              })}
            </div>
            <p aria-live="polite" className="mt-2 min-h-5 text-xs text-text-secondary">{message}</p>
          </section>

          <CompanionStatePanel />

          <section aria-labelledby="her-memory-title">
            <h2 id="her-memory-title" className="px-1 text-sm font-semibold text-text-primary">她记得的你</h2>
            <nav aria-label="记忆分类" className="mt-3 grid grid-cols-3 gap-2">
              {MEMORY_TABS.map(item => (
                <button
                  key={item.id}
                  type="button"
                  aria-current={tab === item.id ? 'page' : undefined}
                  onClick={() => setParams({ tab: item.id }, { replace: true })}
                  className={`min-h-11 rounded-full text-sm transition-colors duration-300 ease-calm ${tab === item.id ? 'bg-action-primary text-text-inverse' : 'border border-border-subtle bg-surface-card text-text-secondary hover:bg-surface-muted'}`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </section>
        </div>
        <div className="mx-auto max-w-3xl">
          {tab === 'saved' ? <MemoriesPage embedded /> : <MemoryReviewPanel key={tab} relations={tab === 'relations'} />}
        </div>
      </div>
    </div>
  )
}
