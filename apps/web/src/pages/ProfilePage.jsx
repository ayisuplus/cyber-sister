import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Brain, ChevronRight, Crown, Download, Drama, LogOut, Palette, Shield, Sparkles } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { useAppearanceStore } from '../stores/appearanceStore'
import { consentService } from '../services/consentService'
import { migrationService, userService } from '../services/userService'
import { useAuthedImageUrl } from '../hooks/useAuthedImageUrl'
import Header from '../components/layout/Header'
import ImportMigration from '../components/profile/ImportMigration'
import TabBar from '../components/layout/TabBar'

import { PERSONAS } from '../features/personas'

export default function ProfilePage() {
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const updatePersona = useAuthStore(s => s.updatePersona)
  const updateRolePlay = useAuthStore(s => s.updateRolePlay)
  const clearRolePlay = useAuthStore(s => s.clearRolePlay)
  const logout = useAuthStore(s => s.logout)
  const [savingPersona, setSavingPersona] = useState(false)
  const [consent, setConsent] = useState(undefined)
  const [savingConsent, setSavingConsent] = useState(false)
  const [message, setMessage] = useState('')
  const [roleName, setRoleName] = useState(user?.roleName ?? '')
  const [roleSetting, setRoleSetting] = useState(user?.roleSetting ?? '')
  const [savingRole, setSavingRole] = useState(false)
  const homeBgUrl = useAppearanceStore(s => s.homeBgUrl)
  const chatBgUrl = useAppearanceStore(s => s.chatBgUrl)
  const setBackground = useAppearanceStore(s => s.setBackground)
  const clearBackground = useAppearanceStore(s => s.clearBackground)
  const avatarUrl = useAuthedImageUrl(user?.avatarUrl)
  const [busySlot, setBusySlot] = useState(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    consentService.get().then(setConsent).catch(() => setMessage('无法读取云端模型设置'))
  }, [])

  const handleExport = async () => {
    if (exporting) return
    setExporting(true)
    setMessage('')
    try {
      const filename = await migrationService.downloadExport()
      setMessage(`已导出到 ${filename}：人格、记忆、对话、日记、手帐、日程全部在内`)
    } catch {
      setMessage('导出失败，请重试')
    } finally {
      setExporting(false)
    }
  }

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

  const handleRoleSave = async () => {
    if (savingRole || !roleName.trim() || !roleSetting.trim()) return
    setSavingRole(true); setMessage('')
    try {
      await updateRolePlay({ name: roleName.trim(), setting: roleSetting.trim() })
      setMessage('角色已设置，下一条消息立即生效')
    } catch {
      setMessage('角色设置失败，请重试')
    } finally {
      setSavingRole(false)
    }
  }

  const handleRoleClear = async () => {
    if (savingRole) return
    setSavingRole(true); setMessage('')
    try {
      await clearRolePlay()
      setRoleName(''); setRoleSetting('')
      setMessage('已清除角色设定')
    } catch {
      setMessage('清除失败，请重试')
    } finally {
      setSavingRole(false)
    }
  }

  const handleConsent = async (accepted) => {
    setSavingConsent(true)
    setMessage('')
    try {
      const updated = await consentService.update(accepted)
      setConsent(updated)
      setMessage(accepted ? '已允许云端模型，聊天会外发给模型供应商' : '已关闭云端模型，聊天将不可用')
    } catch {
      setMessage('云端模型设置保存失败，请重试')
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

  // 形象资产上传：头像写回 authStore，背景走 appearanceStore；按行 busy
  const handleAsset = async (slot, file) => {
    if (busySlot) return
    setBusySlot(slot)
    setMessage('')
    try {
      if (slot === 'avatar') {
        const result = await userService.uploadAsset('avatar', file)
        useAuthStore.getState().updateProfile({ avatarUrl: result.url })
      } else {
        await setBackground(slot, file)
      }
    } catch {
      setMessage('图片上传失败，请重试')
    } finally {
      setBusySlot(null)
    }
  }

  const handleAssetRemove = async (slot) => {
    if (busySlot) return
    setBusySlot(slot)
    setMessage('')
    try {
      if (slot === 'avatar') {
        await userService.deleteAsset('avatar')
        useAuthStore.getState().updateProfile({ avatarUrl: null })
      } else {
        await clearBackground(slot)
      }
    } catch {
      setMessage('图片上传失败，请重试')
    } finally {
      setBusySlot(null)
    }
  }

  // 重置 input value 以便同图重选
  const handleAssetPick = (slot) => async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) await handleAsset(slot, file)
  }

  const consentLabel = consent?.accepted === true
    ? '已接受'
    : consent?.accepted === false
      ? '已拒绝或撤回'
      : '尚未选择'

  return (
    <div className="flex-1 flex flex-col bg-transparent overflow-hidden">
      <Header title="我的" />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <section aria-labelledby="profile-name" className="w-full bg-surface-card rounded-[20px] p-4 shadow-card flex items-center gap-4">
          {avatarUrl ? (
            <img src={avatarUrl} alt="我的头像" className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-action-primary flex items-center justify-center" aria-hidden="true">
              <span className="text-text-inverse text-xl font-bold">{user?.nickname?.[0] || '姐'}</span>
            </div>
          )}
          <div>
            <h2 id="profile-name" className="text-base font-semibold text-text-primary">{user?.nickname || '内测用户'}</h2>
            <p className="mt-1 text-xs text-text-muted">白名单内测账号</p>
          </div>
        </section>

        <section aria-labelledby="appearance-title" className="bg-surface-card rounded-[20px] p-4 shadow-card">
          <h2 id="appearance-title" className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
            <Palette size={16} className="text-brand-pink" />
            装扮
          </h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {avatarUrl ? (
                <img src={avatarUrl} alt="头像预览" className="h-14 w-14 rounded-full object-cover" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-action-primary flex items-center justify-center" aria-hidden="true">
                  <span className="text-text-inverse text-xl font-bold">{user?.nickname?.[0] || '姐'}</span>
                </div>
              )}
              <span className="flex-1 text-sm text-text-primary">头像</span>
              <label className={`flex min-h-11 cursor-pointer items-center rounded-xl bg-action-primary px-3 text-xs font-semibold text-text-inverse ${busySlot === 'avatar' ? 'opacity-50' : ''}`}>
                更换头像
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="更换头像"
                  disabled={busySlot === 'avatar'}
                  className="hidden"
                  onChange={handleAssetPick('avatar')}
                />
              </label>
              {avatarUrl && (
                <button type="button" disabled={busySlot === 'avatar'} onClick={() => handleAssetRemove('avatar')} className="min-h-11 rounded-xl border border-border-subtle px-3 text-xs font-semibold text-text-secondary disabled:opacity-50">
                  移除
                </button>
              )}
            </div>

            {[
              { slot: 'bg-home', label: '主页背景', url: homeBgUrl, inputLabel: '选择主页背景图片' },
              { slot: 'bg-chat', label: '聊天背景', url: chatBgUrl, inputLabel: '选择聊天背景图片' },
            ].map(({ slot, label, url, inputLabel }) => (
              <div key={slot} className="flex items-center gap-3">
                {url ? (
                  <img src={url} alt={`${label}预览`} className="h-14 w-14 rounded-xl object-cover" />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-dashed border-border-default text-[10px] text-text-muted">未设置</div>
                )}
                <span className="flex-1 text-sm text-text-primary">{label}</span>
                <label className={`flex min-h-11 cursor-pointer items-center rounded-xl border border-border-subtle px-3 text-xs font-semibold text-text-secondary ${busySlot === slot ? 'opacity-50' : ''}`}>
                  选择图片
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    aria-label={inputLabel}
                    disabled={busySlot === slot}
                    className="hidden"
                    onChange={handleAssetPick(slot)}
                  />
                </label>
                {url && (
                  <button type="button" disabled={busySlot === slot} onClick={() => handleAssetRemove(slot)} className="min-h-11 rounded-xl border border-border-subtle px-3 text-xs font-semibold text-text-secondary disabled:opacity-50">
                    移除
                  </button>
                )}
              </div>
            ))}
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

        <section aria-labelledby="roleplay-title" className="bg-surface-card rounded-[20px] p-4 shadow-card">
          <h2 id="roleplay-title" className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
            <Drama size={16} className="text-brand-pink" />
            角色扮演
          </h2>
          <p className="mb-3 text-xs leading-relaxed text-text-secondary">设定后，姐妹会在聊天里以这个角色陪你；人格语气照旧。</p>
          <input
            aria-label="角色名"
            value={roleName}
            maxLength={20}
            onChange={event => setRoleName(event.target.value)}
            placeholder="她想扮演的角色，比如：同桌的你"
            className="w-full rounded-2xl bg-surface-input p-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-status-info"
          />
          <textarea
            aria-label="角色设定"
            value={roleSetting}
            maxLength={200}
            rows={3}
            onChange={event => setRoleSetting(event.target.value)}
            placeholder="她的身份、和你们的关系、说话特点……"
            className="mt-2 w-full resize-none rounded-2xl bg-surface-input p-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-status-info"
          />
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={savingRole || !roleName.trim() || !roleSetting.trim()} onClick={handleRoleSave} className="min-h-11 flex-1 rounded-xl bg-action-primary text-xs font-semibold text-text-inverse hover:bg-action-hover focus:ring-2 focus:ring-status-info disabled:opacity-50">
              保存角色
            </button>
            {user?.roleName && (
              <button type="button" disabled={savingRole} onClick={handleRoleClear} className="min-h-11 rounded-xl border border-border-subtle px-4 text-xs font-semibold text-text-secondary disabled:opacity-50">
                清除角色
              </button>
            )}
          </div>
        </section>


        <section aria-labelledby="data-migration-title" className="bg-surface-card rounded-[20px] p-4 shadow-card">
          <h2 id="data-migration-title" className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Download size={16} className="text-status-info" />
            数据与迁移
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-text-secondary">你的数据归你。随时可以把人格、角色扮演、显式记忆、全部对话、日记、手帐、日程、倒数日、经期、提醒、阅读和自习导出为一个 JSON 文件带走——永久免费，不设会员门槛，不需要任何理由。</p>
          <button type="button" disabled={exporting} onClick={handleExport} className="mt-3 min-h-11 w-full rounded-xl bg-action-primary text-xs font-semibold text-text-inverse hover:bg-action-hover focus:ring-2 focus:ring-status-info disabled:opacity-50">
            {exporting ? '正在导出…' : '导出我的全部数据（JSON）'}
          </button>
          <ImportMigration />
        </section>
        <section aria-labelledby="consent-settings-title" className="bg-surface-card rounded-[20px] p-4 shadow-card">
          <h2 id="consent-settings-title" className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Shield size={16} className="text-brand-green" />
            云端模型
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-text-secondary">{consent?.version || 'cloud-primary-v1'} · {consentLabel}。聊天由经批准的云端模型提供：你的消息（经脱敏，最多 20 条消息与最多 5 条相关显式记忆）会发送到该模型处理；拒绝或撤回后聊天不可用。</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" disabled={savingConsent} onClick={() => handleConsent(false)} className="min-h-11 rounded-xl border border-border-subtle text-xs font-semibold text-text-secondary disabled:opacity-50">暂不开启</button>
            <button type="button" disabled={savingConsent} onClick={() => handleConsent(true)} className="min-h-12 rounded-xl bg-action-primary hover:bg-action-hover text-xs font-semibold text-text-inverse focus:ring-2 focus:ring-status-info disabled:opacity-50" style={{ boxShadow: 'var(--cs-shadow-button)' }}>允许云端模型</button>
          </div>
        </section>

        <button type="button" onClick={() => navigate('/profile/memories')} className="min-h-14 w-full rounded-[20px] bg-surface-card px-4 shadow-card flex items-center gap-3">
          <Brain size={18} className="text-status-info" />
          <span className="flex-1 text-left text-sm text-text-primary">显式记忆管理</span>
          <ChevronRight size={16} className="text-text-muted" />
        </button>

        <button type="button" onClick={() => navigate('/profile/membership')} className="min-h-14 w-full rounded-[20px] bg-surface-card px-4 shadow-card flex items-center gap-3">
          <Crown size={18} className="text-action-primary" />
          <span className="flex-1 text-left">
            <span className="block text-sm text-text-primary">会员中心</span>
            <span className="block text-[11px] text-text-muted">内测期间免费 · 会员体系规划中</span>
          </span>
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
