import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToolsStore } from '../stores/toolsStore'
import { profileService } from '../services/userService'
import Header from '../components/layout/Header'
import Card from '../components/ui/Card'
import { Bell, Shield, Info, ChevronRight, ToggleLeft, ToggleRight } from 'lucide-react'

// 只保留真实可用的设置项：3 个服务端提醒开关 + 「她来想你」总开关（users.care_enabled 真实生效）
// + 记忆管理入口 + 版本信息。死按钮（清空记忆/对话/用户协议）、假注销已移除；
export default function SettingsPage() {
  const navigate = useNavigate()

  const { reminders, loadReminders, toggleReminder } = useToolsStore()
  const [careEnabled, setCareEnabled] = useState(null)
  useEffect(() => {
    profileService.get()
      .then((profile) => setCareEnabled(profile?.careEnabled !== false))
      .catch(() => setCareEnabled(null))
  }, [])

  const toggleCare = async () => {
    if (careEnabled === null) return
    const next = !careEnabled
    setCareEnabled(next)
    try {
      await profileService.update({ careEnabled: next })
    } catch {
      setCareEnabled(!next)
    }
  }

  useEffect(() => {
    loadReminders()
  }, [loadReminders])

  const reminderOf = (type) => reminders.find(r => r.type === type)

  return (
    <div className="flex-1 flex flex-col bg-transparent overflow-hidden">
      <Header title="设置" showBack />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
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
                <button onClick={() => reminder && toggleReminder(reminder.id)} disabled={unavailable} className="disabled:opacity-40">
                  {enabled ? (
                    <ToggleRight size={24} className="text-brand-pink" />
                  ) : (
                    <ToggleLeft size={24} className="text-text-muted" />
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
            <button onClick={toggleCare} disabled={careEnabled === null} aria-label="她来想你总开关" className="disabled:opacity-40">
              {careEnabled ? (
                <ToggleRight size={24} className="text-brand-pink" />
              ) : (
                <ToggleLeft size={24} className="text-text-muted" />
              )}
            </button>
          </div>
        </Card>

        {/* 隐私与安全 */}
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-border-subtle">
            <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Shield size={16} className="text-brand-green" />
              隐私与安全
            </h3>
          </div>
          <button
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
      </div>
    </div>
  )
}
