import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import Header from '../components/layout/Header'
import TabBar from '../components/layout/TabBar'
import { Settings, ChevronRight, Brain, Shield, Bell, Info, LogOut, Crown, Sparkles } from 'lucide-react'

const PERSONAS = [
  { id: 'toxic', name: '毒舌互怼', tag: '毒舌·护短·嘴硬心软', color: 'border-brand-pink', gradient: 'from-pink-500 to-rose-500', isDefault: true },
  { id: 'gentle', name: '温柔姐姐', tag: '包容·耐心·讲道理', color: 'border-brand-purple', gradient: 'from-purple-500 to-violet-500', isDefault: true },
  { id: 'wild', name: '疯批搭子', tag: '疯·嗨·情绪宣泄', color: 'border-brand-yellow', gradient: 'from-yellow-500 to-orange-500', isVip: true },
]

const MENU_ITEMS = [
  { icon: Brain, label: '记忆管理', path: '/profile/memories', color: 'text-brand-purple' },
  { icon: Shield, label: '隐私与安全', path: '/settings', color: 'text-brand-green' },
  { icon: Bell, label: '通知设置', path: '/settings', color: 'text-brand-blue' },
  { icon: Info, label: '关于赛博姐妹', path: '/settings', color: 'text-brand-yellow' },
]

export default function ProfilePage() {
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const updatePersona = useAuthStore(s => s.updatePersona)
  const logout = useAuthStore(s => s.logout)

  const handlePersonaSwitch = (persona) => {
    if (persona.isVip && !user?.isVip) {
      navigate('/membership')
      return
    }
    updatePersona(persona.id)
  }

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex-1 flex flex-col bg-bg-message overflow-hidden">
      <Header
        title="我的"
        rightAction={
          <button onClick={() => navigate('/settings')}>
            <Settings size={20} className="text-text-secondary" />
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* 用户卡片 */}
        <button
          onClick={() => navigate('/membership')}
          className="w-full bg-white rounded-[20px] p-4 shadow-card flex items-center gap-4"
        >
          <div className="w-14 h-14 rounded-full bg-gradient-pink-purple flex items-center justify-center">
            <span className="text-white text-xl font-bold">{user?.nickname?.[0] || '小'}</span>
          </div>
          <div className="flex-1 text-left">
            <h2 className="text-base font-semibold text-text-primary">{user?.nickname || '小仙女'}</h2>
            <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full mt-1 ${user?.isVip ? 'bg-brand-pink text-white' : 'bg-gray-100 text-text-muted'}`}>
              {user?.isVip ? 'VIP会员' : '免费版'}
            </span>
          </div>
          <ChevronRight size={20} className="text-text-muted" />
        </button>

        {/* 人格切换 */}
        <div className="bg-white rounded-[20px] p-4 shadow-card">
          <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
            <Sparkles size={16} className="text-brand-pink" />
            切换人格
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {PERSONAS.map(p => {
              const isActive = user?.persona === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => handlePersonaSwitch(p)}
                  className={`relative p-3 rounded-xl border-2 transition-all ${
                    isActive ? `${p.color} bg-gradient-to-b ${p.gradient} bg-opacity-5` : 'border-transparent bg-gray-50'
                  }`}
                >
                  {p.isVip && (
                    <Crown size={12} className="absolute top-1 right-1 text-brand-yellow" />
                  )}
                  <p className={`text-xs font-semibold ${isActive ? 'text-text-primary' : 'text-text-secondary'}`}>
                    {p.name}
                  </p>
                  <p className="text-[10px] text-text-muted mt-0.5">{p.tag}</p>
                  {isActive && (
                    <span className="mt-2 inline-block text-[9px] px-1.5 py-0.5 bg-brand-pink text-white rounded-full">
                      当前使用
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* 设置菜单 */}
        <div className="bg-white rounded-[20px] shadow-card overflow-hidden">
          {MENU_ITEMS.map((item, i) => {
            const Icon = item.icon
            return (
              <button
                key={item.label}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors ${
                  i < MENU_ITEMS.length - 1 ? 'border-b border-border-subtle' : ''
                }`}
              >
                <Icon size={18} className={item.color} />
                <span className="flex-1 text-sm text-text-primary text-left">{item.label}</span>
                <ChevronRight size={16} className="text-text-muted" />
              </button>
            )
          })}
        </div>

        {/* 退出登录 */}
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 py-3 text-red-500 text-sm hover:bg-red-50 rounded-xl transition-colors"
        >
          <LogOut size={16} />
          退出登录
        </button>
      </div>

      <TabBar />
    </div>
  )
}
