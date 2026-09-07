import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToolsStore } from '../stores/toolsStore'
import Header from '../components/layout/Header'
import Card from '../components/ui/Card'
import { Bell, Shield, Info, ChevronRight, ToggleLeft, ToggleRight } from 'lucide-react'

// 只保留真实可用的设置项：3 个服务端提醒开关 + 记忆管理入口 + 版本信息。
// 主动关怀开关（无效果）、死按钮（清空记忆/对话/用户协议）、假注销已移除；
// 退出登录在「我的」页，记忆清空在记忆管理页。
export default function SettingsPage() {
  const navigate = useNavigate()

  const { reminders, loadReminders, toggleReminder } = useToolsStore()

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
