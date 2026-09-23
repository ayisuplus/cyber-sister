import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Archive, Bell, ChevronRight, Download, Eraser, LogOut, Moon, Monitor, Palette, Shield, Sun, ToggleLeft, ToggleRight } from 'lucide-react'
import { useThemeStore } from '../stores/themeStore'
import { useAuthStore } from '../stores/authStore'
import { useAppearanceStore } from '../stores/appearanceStore'
import { useChatStore } from '../stores/chatStore'
import { migrationService, profileService, userService } from '../services/userService'
import { useAuthedImageUrl } from '../hooks/useAuthedImageUrl'
import Header from '../components/layout/Header'
import Card from '../components/ui/Card'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import CloudModelSettings from '../components/chat/CloudModelSettings'
import ModelProviderSettings from '../components/chat/ModelProviderSettings'
import ImportMigration from '../components/profile/ImportMigration'
import LocalBridgeSettings from '../components/profile/LocalBridgeSettings'
import AboutYouSettings from '../components/profile/AboutYouSettings'
import LetterFontSetting from '../components/profile/LetterFontSetting'

const BACKGROUND_SLOTS = [
  { slot: 'bg-home', label: '主页背景', inputLabel: '选择主页背景图片' },
  { slot: 'bg-chat', label: '聊天背景', inputLabel: '选择聊天背景图片' },
]

// 设置：原「我的」与「设置」合并为一处——形象、外观、聊天模型（唯一授权开关）、关怀、数据与隐私、退出。
// 说话方式与记忆在「她」页面；只保留真实可用的开关。
export default function SettingsPage() {
  const navigate = useNavigate()
  const { preference, setPreference } = useThemeStore()
  const user = useAuthStore(state => state.user)
  const logout = useAuthStore(state => state.logout)
  const homeBgUrl = useAppearanceStore(state => state.homeBgUrl)
  const chatBgUrl = useAppearanceStore(state => state.chatBgUrl)
  const setBackground = useAppearanceStore(state => state.setBackground)
  const clearBackground = useAppearanceStore(state => state.clearBackground)
  const avatarUrl = useAuthedImageUrl(user?.avatarUrl)
  const [careEnabled, setCareEnabled] = useState(null)
  const [saving, setSaving] = useState(null)
  const [busySlot, setBusySlot] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearError, setClearError] = useState('')
  const clearThread = useChatStore(state => state.clearThread)

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

  // 形象资产：头像写回 authStore，背景走 appearanceStore；按槽位 busy
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
      setMessage('图片移除失败，请重试')
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

  const handleExport = async () => {
    if (exporting) return
    setExporting(true)
    setMessage('')
    try {
      const filename = await migrationService.downloadExport()
      setMessage(`已发起下载 ${filename}：请在浏览器下载记录中确认文件已保存`)
    } catch {
      setMessage('导出失败，请重试')
    } finally {
      setExporting(false)
    }
  }

  const handleClearHistory = async () => {
    if (saving) return
    setSaving('clear')
    setClearError('')
    try {
      await clearThread()
      setConfirmClear(false)
      setMessage('聊天记录已清空')
    } catch {
      setClearError('没清空成功，聊天记录仍在，请重试。')
    } finally {
      setSaving(null)
    }
  }

  const handleLogout = async () => {
    if (saving) return
    setSaving('logout')
    setError('')
    try { await logout(); navigate('/login', { replace: true }) }
    catch { setError('退出登录失败，请重试。') }
    finally { setSaving(null) }
  }

  const rowButton = 'flex min-h-11 w-full items-center justify-between px-4 py-3 text-sm text-text-primary transition-colors duration-300 ease-calm hover:bg-surface-muted'
  const pickButton = (busy) => `flex min-h-11 cursor-pointer items-center rounded-xl border border-border-subtle px-3 text-xs font-semibold text-text-secondary ${busy ? 'opacity-50' : ''}`

  return (
    <div className="flex-1 flex flex-col bg-transparent overflow-hidden">
      <Header title="设置" showBack />

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="px-1 pb-1">
            <p className="display-serif text-xl font-semibold text-text-primary">让 Amie 更合你的习惯</p>
            <p className="mt-2 text-xs text-text-muted">她怎么叫你、形象、外观、模型和关怀，都可以在这里调整。她的说话方式和记忆在「她」页面。</p>
          </div>

          {error && <p role="alert" className="rounded-control bg-pastel-blush p-3 text-sm text-danger">{error}</p>}

          <AboutYouSettings />

          <Card className="overflow-hidden">
            <section aria-labelledby="appearance-assets-title" className="p-4">
              <h2 id="appearance-assets-title" className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
                <Palette size={16} className="text-action-primary" aria-hidden="true" />
                形象
              </h2>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="头像预览" className="h-14 w-14 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-action-primary" aria-hidden="true">
                      <span className="text-xl font-bold text-text-inverse">{user?.nickname?.[0] || '姐'}</span>
                    </div>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-text-primary">头像</span>
                    <span className="block truncate text-[11px] text-text-muted">{user?.nickname || '内测用户'} · 白名单内测账号</span>
                  </span>
                  <label className={`flex min-h-11 cursor-pointer items-center rounded-xl bg-action-primary px-3 text-xs font-semibold text-text-inverse ${busySlot === 'avatar' ? 'opacity-50' : ''}`}>
                    更换头像
                    <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="更换头像" disabled={busySlot === 'avatar'} className="hidden" onChange={handleAssetPick('avatar')} />
                  </label>
                  {avatarUrl && (
                    <button type="button" disabled={busySlot === 'avatar'} onClick={() => handleAssetRemove('avatar')} className="min-h-11 rounded-xl border border-border-subtle px-3 text-xs font-semibold text-text-secondary disabled:opacity-50">移除</button>
                  )}
                </div>

                {BACKGROUND_SLOTS.map(({ slot, label, inputLabel }) => {
                  const url = slot === 'bg-home' ? homeBgUrl : chatBgUrl
                  return (
                    <div key={slot} className="flex items-center gap-3">
                      {url ? (
                        <img src={url} alt={`${label}预览`} className="h-14 w-14 rounded-xl object-cover" />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-dashed border-border-default text-[10px] text-text-muted">未设置</div>
                      )}
                      <span className="flex-1 text-sm text-text-primary">{label}</span>
                      <label className={pickButton(busySlot === slot)}>
                        选择图片
                        <input type="file" accept="image/jpeg,image/png,image/webp" aria-label={inputLabel} disabled={busySlot === slot} className="hidden" onChange={handleAssetPick(slot)} />
                      </label>
                      {url && (
                        <button type="button" disabled={busySlot === slot} onClick={() => handleAssetRemove(slot)} className="min-h-11 rounded-xl border border-border-subtle px-3 text-xs font-semibold text-text-secondary disabled:opacity-50">移除</button>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          </Card>

          <Card className="overflow-hidden">
            <fieldset>
              <legend className="w-full border-b border-border-subtle px-4 py-3 text-sm font-semibold text-text-primary">
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
                <LetterFontSetting />
              </div>
            </fieldset>
          </Card>

          <CloudModelSettings />

          {/* 只有实例管理员看得见；不是管理员时整张卡片不渲染 */}
          <ModelProviderSettings />

          <Card className="overflow-hidden">
            <div className="border-b border-border-subtle px-4 py-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <Bell size={16} className="text-brand-blue" aria-hidden="true" />
                关怀
              </h3>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0 flex-1">
                <span className="text-sm text-text-primary">她来想你</span>
                <p className="mt-0.5 text-[11px] text-text-muted">基于你日历上的事与记录，只发有用的关怀卡片（无推送）</p>
              </div>
              <button type="button" onClick={toggleCare} disabled={careEnabled === null || saving !== null} aria-label="她来想你总开关" role="switch" aria-checked={careEnabled === true} className="flex h-11 w-11 items-center justify-center disabled:opacity-40">
                {careEnabled ? (
                  <ToggleRight size={24} className="text-brand-pink" aria-hidden="true" />
                ) : (
                  <ToggleLeft size={24} className="text-text-muted" aria-hidden="true" />
                )}
              </button>
            </div>
          </Card>

          <LocalBridgeSettings />

          <Card className="overflow-hidden">
            <section aria-labelledby="data-migration-title" className="p-4">
              <h2 id="data-migration-title" className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <Download size={16} className="text-status-info" aria-hidden="true" />
                数据与迁移
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-text-secondary">你的数据归你。随时可以把说话方式、显式记忆、全部对话、日记、安排、经期、阅读，连同以前的日程、倒数日、手帐和自习记录，导出为一个 JSON 文件带走——永久免费，不设会员门槛，不需要任何理由。</p>
              <button type="button" disabled={exporting} onClick={handleExport} className="mt-3 min-h-11 w-full rounded-xl bg-action-primary text-xs font-semibold text-text-inverse hover:bg-action-hover focus:ring-2 focus:ring-status-info disabled:opacity-50">
                {exporting ? '正在导出…' : '导出我的全部数据（JSON）'}
              </button>
              <ImportMigration />
            </section>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-border-subtle px-4 py-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <Shield size={16} className="text-brand-green" aria-hidden="true" />
                隐私与记录
              </h3>
            </div>
            <button type="button" onClick={() => navigate('/chat/archives')} className={rowButton}><span className="flex items-center gap-2"><Archive size={16} aria-hidden="true" />以前归档的对话</span><ChevronRight size={16} aria-hidden="true" /></button>
            <button type="button" disabled={saving !== null} onClick={() => { setClearError(''); setConfirmClear(true) }} className={`${rowButton} text-danger disabled:opacity-50`}><span className="flex items-center gap-2"><Eraser size={16} aria-hidden="true" />清空聊天记录</span></button>
          </Card>

          <p aria-live="polite" className="min-h-5 text-center text-xs text-text-secondary">{message}</p>

          <button type="button" disabled={saving !== null} onClick={handleLogout} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-card border border-border-subtle bg-surface-card text-sm text-danger disabled:opacity-50"><LogOut size={16} aria-hidden="true" />退出登录</button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmClear}
        title="清空聊天记录"
        description="和她的这段对话里的全部消息与照片都会删除，无法恢复。她记得的你、她的状态和以前归档的对话不受影响。"
        confirmLabel="确认清空"
        danger
        busy={saving === 'clear'}
        error={clearError}
        onConfirm={handleClearHistory}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  )
}
