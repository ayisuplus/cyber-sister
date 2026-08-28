import { useNavigate } from 'react-router-dom'
import { useToolsStore } from '../stores/toolsStore'
import Header from '../components/layout/Header'
import TabBar from '../components/layout/TabBar'
import { CloudSun, Droplets, Timer, CheckSquare, Bell, Moon, Search, Sparkles } from 'lucide-react'

const TOOL_ITEMS = [
  { icon: CloudSun, label: '天气提醒', color: 'bg-blue-100 text-brand-blue', path: '/tools' },
  { icon: Droplets, label: '大姨妈记录', color: 'bg-pink-100 text-brand-pink', path: '/tools/period' },
  { icon: Timer, label: '倒数日', color: 'bg-purple-100 text-brand-purple', path: '/tools/countdown' },
  { icon: CheckSquare, label: '待办提醒', color: 'bg-green-100 text-brand-green', path: '/tools/todo' },
  { icon: Bell, label: '喝水提醒', color: 'bg-cyan-100 text-cyan-500', path: '/tools' },
  { icon: Moon, label: '睡觉提醒', color: 'bg-indigo-100 text-indigo-500', path: '/tools' },
]

export default function ToolsPage() {
  const navigate = useNavigate()
  const weather = useToolsStore(s => s.weather)
  const reminders = useToolsStore(s => s.reminders)
  const activeReminders = reminders.filter(r => r.isActive)

  return (
    <div className="flex-1 flex flex-col bg-bg-message overflow-hidden">
      <Header
        title="工具箱"
        rightAction={<Search size={20} className="text-text-secondary" />}
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* 主动关怀卡片 */}
        <div className="bg-gradient-pink-purple rounded-[20px] p-5 text-white">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={18} />
            <span className="text-sm font-semibold">今日提醒</span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <CloudSun size={14} />
              <span>{weather.city} {weather.temp}°C {weather.condition}，{weather.tip}</span>
            </div>
            {activeReminders.length > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <Bell size={14} />
                <span>今天有 {activeReminders.length} 个提醒待触发</span>
              </div>
            )}
          </div>
        </div>

        {/* 工具网格 */}
        <div className="grid grid-cols-2 gap-3">
          {TOOL_ITEMS.map(tool => {
            const Icon = tool.icon
            return (
              <button
                key={tool.label}
                onClick={() => navigate(tool.path)}
                className="bg-white rounded-[16px] p-4 shadow-card hover:shadow-md transition-all text-left"
              >
                <div className={`w-10 h-10 rounded-xl ${tool.color} flex items-center justify-center mb-3`}>
                  <Icon size={20} />
                </div>
                <h3 className="text-sm font-semibold text-text-primary">{tool.label}</h3>
              </button>
            )
          })}
        </div>
      </div>

      <TabBar />
    </div>
  )
}
