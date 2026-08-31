import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Brain, ChevronRight, Cpu, LogOut, Shield, Sparkles } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { consentService } from '../services/consentService'
import Header from '../components/layout/Header'
import TabBar from '../components/layout/TabBar'

import { PERSONAS } from '../features/personas'

export default function ProfilePage() {
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const updatePersona = useAuthStore(s => s.updatePersona)
  const logout = useAuthStore(s => s.logout)
  const [savingPersona, setSavingPersona] = useState(false)
  const [consent, setConsent] = useState(undefined)
  const [savingConsent, setSavingConsent] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    consentService.get().then(setConsent).catch(() => setMessage('无法读取云端备用设置'))
  }, [])

  const handlePersonaSwitch = async (persona) => {
    if (savingPersona || persona === user?.persona) return
    setSavingPersona(true)
    setMessage('')
    try {
      await updatePersona(persona)
      setMessage('人格已切换，下一条消息立即生效')
    } catch {
      setMessage('人格切换失败，请重试')
    } finally {
      setSavingPersona(false)
    }
  }

  const handleConsent = async (accepted) => {
    setSavingConsent(true)
    setMessage('')
    try {
      const updated = await consentService.update(accepted)
      setConsent(updated)
      setMessage(accepted ? '已允许本地模型失败时使用云端备用' : '已关闭云端备用，聊天不会外发给模型供应商')
    } catch {
      setMessage('云端备用设置保存失败，请重试')
    } finally {
      setSavingConsent(false)
    }
  }

  const handleLogout = async () => {
    try {
      await logout()
      navigate('/login', { replace: true })
    } catch {
      setMessage('退出失败，服务端尚未确认令牌撤销，请稍后重试')
    }
  }

  const consentLabel = consent?.accepted === true
    ? '已接受'
    : consent?.accepted === false
      ? '已拒绝或撤回'
      : '尚未选择'

  return (
    <div className="flex-1 flex flex-col bg-surface-page overflow-hidden">
      <Header title="我的" />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <section aria-labelledby="profile-name" className="w-full bg-surface-card rounded-[20px] p-4 shadow-card flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-action-primary flex items-center justify-center" aria-hidden="true">
            <span className="text-text-inverse text-xl font-bold">{user?.nickname?.[0] || '姐'}</span>
          </div>
          <div>
            <h2 id="profile-name" className="text-base font-semibold text-text-primary">{user?.nickname || '内测用户'}</h2>
            <p className="mt-1 text-xs text-text-muted">白名单内测账号</p>
          </div>
        </section>

        <section aria-labelledby="persona-title" className="bg-surface-card rounded-[20px] p-4 shadow-card">
          <h2 id="persona-title" className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
            <Sparkles size={16} className="text-brand-pink" />
            切换人格
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {PERSONAS.map(persona => {
              const active = user?.persona === persona.id
              return (
                <button
                  key={persona.id}
                  type="button"
                  aria-pressed={active}
                  disabled={savingPersona}
                  onClick={() => handlePersonaSwitch(persona.id)}
                  className={`min-h-[88px] rounded-xl border-2 p-2 transition-colors disabled:opacity-50 ${active ? `${persona.color} ${persona.surface} ring-2 ring-status-info` : 'border-transparent bg-surface-input'}`}
                >
                  <span className="block text-xs font-semibold text-text-primary">{persona.name}</span>
                  <span className="mt-1 block text-[10px] text-text-muted">{persona.profileTag}</span>
                  {active && <span className="mt-2 inline-block rounded-full bg-surface-muted px-2 py-0.5 text-[9px] text-text-secondary">当前使用</span>}
                </button>
              )
            })}
          </div>
        </section>

        <section aria-labelledby="consent-settings-title" className="bg-surface-card rounded-[20px] p-4 shadow-card">
          <h2 id="consent-settings-title" className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Shield size={16} className="text-brand-green" />
            云端备用模型
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-text-secondary">{consent?.version || 'qwen-fallback-v1'} · {consentLabel}。赛博姐妹始终优先使用本地模型；只有本地不可用且你接受后，才会向云端发送经脱敏的最多 20 条消息及最多 5 条相关显式记忆。妆教绝不发送图片。</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" disabled={savingConsent} onClick={() => handleConsent(false)} className="min-h-11 rounded-xl border border-border-subtle text-xs font-semibold text-text-secondary disabled:opacity-50">保持仅本地</button>
            <button type="button" disabled={savingConsent} onClick={() => handleConsent(true)} className="min-h-12 rounded-xl bg-action-primary hover:bg-action-hover text-xs font-semibold text-text-inverse focus:ring-2 focus:ring-status-info disabled:opacity-50" style={{ boxShadow: 'var(--cs-shadow-button)' }}>允许云端备用</button>
          </div>
        </section>

        <button type="button" onClick={() => navigate('/profile/local-model')} className="min-h-14 w-full rounded-[20px] bg-surface-card border border-border-hairline px-4 flex items-center gap-3">
          <Cpu size={18} className="text-status-local" />
          <span className="flex-1 text-left">
            <span className="block text-sm text-text-primary">本地模型与 llama.cpp</span>
            <span className="block text-[11px] text-text-muted">查看状态；安装管理员可自动发现并配置</span>
          </span>
          <ChevronRight size={16} className="text-text-muted" />
        </button>

        <button type="button" onClick={() => navigate('/profile/memories')} className="min-h-14 w-full rounded-[20px] bg-surface-card px-4 shadow-card flex items-center gap-3">
          <Brain size={18} className="text-status-info" />
          <span className="flex-1 text-left text-sm text-text-primary">显式记忆管理</span>
          <ChevronRight size={16} className="text-text-muted" />
        </button>

        <p aria-live="polite" className="min-h-5 text-center text-xs text-text-secondary">{message}</p>

        <button type="button" onClick={handleLogout} className="min-h-11 w-full rounded-xl text-sm text-danger hover:bg-pastel-blush flex items-center justify-center gap-2">
          <LogOut size={16} />
          退出登录
        </button>
      </div>

      <TabBar />
    </div>
  )
}
