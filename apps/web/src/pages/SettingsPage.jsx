import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import Header from '../components/layout/Header'
import { Bell, Shield, Trash2, Info, ChevronRight, ToggleLeft, ToggleRight, AlertTriangle } from 'lucide-react'

export default function SettingsPage() {
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const logout = useAuthStore(s => s.logout)

  const [notifications, setNotifications] = useState({
    proactive: true,
    water: true,
    sleep: true,
    period: true,
  })

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const toggleNotification = (key) => {
    setNotifications(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const handleDeleteAccount = () => {
    // 模拟注销
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex-1 flex flex-col bg-bg-message overflow-hidden">
      <Header title="设置" showBack />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* 通知设置 */}
        <div className="bg-white rounded-[20px] shadow-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border-subtle">
            <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Bell size={16} className="text-brand-blue" />
              通知设置
            </h3>
          </div>
          {[
            { key: 'proactive', label: '主动关怀消息' },
            { key: 'water', label: '喝水提醒' },
            { key: 'sleep', label: '睡觉提醒' },
            { key: 'period', label: '大姨妈提醒' },
          ].map(item => (
            <div key={item.key} className="flex items-center justify-between px-4 py-3 border-b border-border-subtle last:border-0">
              <span className="text-sm text-text-primary">{item.label}</span>
              <button onClick={() => toggleNotification(item.key)}>
                {notifications[item.key] ? (
                  <ToggleRight size={24} className="text-brand-pink" />
                ) : (
                  <ToggleLeft size={24} className="text-text-muted" />
                )}
              </button>
            </div>
          ))}
        </div>

        {/* 隐私与安全 */}
        <div className="bg-white rounded-[20px] shadow-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border-subtle">
            <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Shield size={16} className="text-brand-green" />
              隐私与安全
            </h3>
          </div>
          <button
            onClick={() => navigate('/profile/memories')}
            className="w-full flex items-center justify-between px-4 py-3 border-b border-border-subtle hover:bg-gray-50"
          >
            <span className="text-sm text-text-primary">记忆管理</span>
            <ChevronRight size={16} className="text-text-muted" />
          </button>
          <button
            className="w-full flex items-center justify-between px-4 py-3 border-b border-border-subtle hover:bg-gray-50"
          >
            <span className="text-sm text-text-primary">清空所有记忆</span>
            <Trash2 size={16} className="text-red-500" />
          </button>
          <button
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50"
          >
            <span className="text-sm text-text-primary">一键清空对话记录</span>
            <Trash2 size={16} className="text-red-500" />
          </button>
        </div>

        {/* 关于 */}
        <div className="bg-white rounded-[20px] shadow-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border-subtle">
            <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Info size={16} className="text-brand-yellow" />
              关于
            </h3>
          </div>
          <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
            <span className="text-sm text-text-primary">版本</span>
            <span className="text-sm text-text-muted">1.0.0</span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-text-primary">用户协议</span>
            <ChevronRight size={16} className="text-text-muted" />
          </div>
        </div>

        {/* 注销账号 */}
        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="w-full flex items-center justify-center gap-2 py-3 text-red-500 text-sm hover:bg-red-50 rounded-xl transition-colors"
        >
          <AlertTriangle size={16} />
          注销账号
        </button>
      </div>

      {/* 注销确认弹窗 */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="bg-white rounded-[24px] w-[300px] p-6 text-center animate-fade-in">
            <AlertTriangle size={48} className="text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-text-primary mb-2">确认注销？</h3>
            <p className="text-sm text-text-secondary mb-6">
              注销后所有数据将在7天内彻底删除，此操作不可撤销。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 h-10 bg-gray-100 text-text-secondary text-sm rounded-xl"
              >
                取消
              </button>
              <button
                onClick={handleDeleteAccount}
                className="flex-1 h-10 bg-red-500 text-white text-sm rounded-xl"
              >
                确认注销
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
