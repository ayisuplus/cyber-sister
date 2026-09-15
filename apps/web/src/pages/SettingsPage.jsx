import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToolsStore } from '../stores/toolsStore'
import { useThemeStore } from '../stores/themeStore'
import { useAuthStore } from '../stores/authStore'
import { profileService } from '../services/userService'
import Header from '../components/layout/Header'
import Card from '../components/ui/Card'
import CloudModelSettings from '../components/chat/CloudModelSettings'
import CompanionStatePanel from '../components/chat/CompanionStatePanel'
import { Archive, UserRound, LogOut, Bell, Shield, Info, ChevronRight, ToggleLeft, ToggleRight, Sun, Moon, Monitor } from 'lucide-react'

// 只保留真实可用的本机外观、服务端提醒与关怀开关、记忆管理和版本信息。
export default function SettingsPage() {
  const navigate = useNavigate()

  const { preference, setPreference } = useThemeStore()
  const { reminders, loadReminders, toggleReminder } = useToolsStore()
  const [careEnabled, setCareEnabled] = useState(null)
  const [saving, setSaving] = useState(null)
  const [error, setError] = useState('')
  const logout = useAuthStore(state => state.logout)
  useEffect(() => {
    profileService.get()
      .then((profile) => setCareEnabled(profile?.careEnabled !== false))
      .catch(() => setCareEnabled(null))
  }, [])

  const toggleCare = async () => {
    if (careEnabled === null || saving) return
    const next = !careEnabled
    setSaving('care')
    setError('')
    try {
      await profileService.update({ careEnabled: next })
      setCareEnabled(next)
    } catch {
      setError('关怀设置保存失败，请重试。')
    } finally {
      setSaving(null)
    }
  }

  const saveReminder = async (id) => {
    if (saving) return
    setSaving(id)
    setError('')
    try { await toggleReminder(id) }
    catch { setError('提醒设置保存失败，请重试。') }
    finally { setSaving(null) }
  }

  const handleLogout = async () => {
    if (saving) return
    setSaving('logout')
    setError('')
    try { await logout(); navigate('/login', { replace: true }) }
    catch { setError('退出登录失败，请重试。') }
    finally { setSaving(null) }
  }

  useEffect(() => {
    loadReminders()
  }, [loadReminders])

  const reminderOf = (type) => reminders.find(r => r.type === type)

  return (
    <div className="flex-1 flex flex-col bg-transparent overflow-hidden">
      <Header title="设置" showBack />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="mx-auto max-w-3xl space-y-4">
        <div className="px-1 pb-1">
          <p className="display-serif text-xl font-semibold text-text-primary">让 Amie 更合你的习惯</p>
          <p className="mt-2 text-xs text-text-muted">模型、外观和提醒，都可以在这里调整。</p>
        </div>
        <CloudModelSettings />
        <CompanionStatePanel />
        {error && <p role="alert" className="rounded-control bg-pastel-blush p-3 text-sm text-danger">{error}</p>}
        <Card className="overflow-hidden">
          <fieldset>
            <legend className="w-full px-4 py-3 border-b border-border-subtle text-sm font-semibold text-text-primary">
              <span className="flex items-center gap-2"><Moon size={16} className="text-action-primary" aria-hidden="true" />外观</span>
            </legend>
            <div className="p-4">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: 'light', label: '日间', Icon: Sun },
                  { value: 'dark', label: '夜间', Icon: Moon },
                  { value: 'system', label: '跟随系统', Icon: Monitor },
                ].map(({ value, label, Icon }) => (
                  <label key={value} className={`flex cursor-pointer flex-col items-center gap-2 rounded-control border px-1 py-3 text-xs ${preference === value ? 'border-action-primary bg-pastel-blush text-text-primary' : 'border-border-default bg-surface-card text-text-secondary'}`}>
                    <Icon size={20} aria-hidden="true" />
                    <span>{label}</span>
                    <input
                      type="radio"
                      name="theme"
                      value={value}
                      checked={preference === value}
                      onChange={() => setPreference(value)}
                      aria-label={label}
                      className="h-4 w-4 accent-action-primary"
                    />
                  </label>
                ))}
              </div>
              <p className="mt-3 text-xs text-text-muted">跟随系统会自动切换日夜配色。选择会保存在这台设备上。</p>
            </div>
          </fieldset>
        </Card>

        {/* 通知设置 */}
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-border-subtle">
            <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Bell size={16} className="text-brand-blue" />
              通知设置
            </h3>
          </div>
          {[
            { key: 'water', label: '喝水提醒' },
            { key: 'sleep', label: '睡觉提醒' },
            { key: 'period', label: '大姨妈提醒' },
          ].map(item => {
            const reminder = reminderOf(item.key)
            const enabled = reminder?.isActive ?? false
            const unavailable = !reminder
            return (
              <div key={item.key} className="flex items-center justify-between px-4 py-3 border-b border-border-subtle last:border-0">
                <span className="text-sm text-text-primary">{item.label}</span>
                <button type="button" onClick={() => reminder && saveReminder(reminder.id)} disabled={unavailable || saving !== null} aria-label={item.label} role="switch" aria-checked={enabled} className="flex h-11 w-11 items-center justify-center disabled:opacity-40">
                  {enabled ? (
                    <ToggleRight size={24} className="text-brand-pink" aria-hidden="true" />
                  ) : (
                    <ToggleLeft size={24} className="text-text-muted" aria-hidden="true" />
                  )}
                </button>
              </div>
            )
          })}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="min-w-0 flex-1">
              <span className="text-sm text-text-primary">她来想你</span>
              <p className="mt-0.5 text-[11px] text-text-muted">基于你的真实日程与记录，只发有用的关怀卡片（无推送）</p>
            </div>
            <button type="button" onClick={toggleCare} disabled={careEnabled === null || saving !== null} aria-label="她来想你总开关" role="switch" aria-checked={careEnabled === true} className="flex h-11 w-11 items-center justify-center disabled:opacity-40">
              {careEnabled ? (
                <ToggleRight size={24} className="text-brand-pink" aria-hidden="true" />
              ) : (
                <ToggleLeft size={24} className="text-text-muted" aria-hidden="true" />
              )}
            </button>
          </div>
          <button type="button" onClick={() => navigate('/tools/planner?tab=reminders')} className="flex min-h-11 w-full items-center justify-between border-t border-border-subtle px-4 text-sm text-text-secondary"><span>管理提醒时间与日程</span><ChevronRight size={16} aria-hidden="true" /></button>
        </Card>

        {/* 隐私与安全 */}
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-border-subtle">
            <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Shield size={16} className="text-brand-green" />
              隐私与安全
            </h3>
          </div>
          <button type="button" onClick={() => navigate('/profile')} className="flex min-h-11 w-full items-center justify-between px-4 py-3 text-sm text-text-primary hover:bg-surface-muted"><span className="flex items-center gap-2"><UserRound size={16} aria-hidden="true" />我的资料与装扮</span><ChevronRight size={16} aria-hidden="true" /></button>
          <button type="button" onClick={() => navigate('/chat/archives')} className="flex min-h-11 w-full items-center justify-between px-4 py-3 text-sm text-text-primary hover:bg-surface-muted"><span className="flex items-center gap-2"><Archive size={16} aria-hidden="true" />对话归档</span><ChevronRight size={16} aria-hidden="true" /></button>
          <button
            type="button"
            onClick={() => navigate('/profile/memories')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-muted"
          >
            <span className="text-sm text-text-primary">记忆管理</span>
            <ChevronRight size={16} className="text-text-muted" />
          </button>
        </Card>

        {/* 关于 */}
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-border-subtle">
            <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Info size={16} className="text-brand-yellow" />
              关于
            </h3>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-text-primary">版本</span>
            <span className="text-sm text-text-muted">1.0.0</span>
          </div>
        </Card>
        <button type="button" disabled={saving !== null} onClick={handleLogout} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-card border border-border-subtle bg-surface-card text-sm text-danger disabled:opacity-50"><LogOut size={16} aria-hidden="true" />退出登录</button>
        </div>
      </div>
    </div>
  )
}
