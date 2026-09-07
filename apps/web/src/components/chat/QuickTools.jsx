import { useNavigate } from 'react-router-dom'
import { CloudSun, Bell, Droplets, CheckSquare } from 'lucide-react'

const tools = [
  { icon: CloudSun, label: '天气', path: '/tools', color: 'text-brand-blue' },
  { icon: Bell, label: '提醒', path: '/tools', color: 'text-brand-yellow' },
  { icon: Droplets, label: '大姨妈', path: '/tools/period', color: 'text-brand-pink' },
  { icon: CheckSquare, label: '待办', path: '/tools/todo', color: 'text-brand-green' },
]

export default function QuickTools() {
  const navigate = useNavigate()

  return (
    <div className="flex gap-2 px-4 py-2 overflow-x-auto">
      {tools.map(tool => {
        const Icon = tool.icon
        return (
          <button
            key={tool.label}
            onClick={() => navigate(tool.path)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-card rounded-full shadow-card text-xs text-text-secondary hover:shadow-md transition-all whitespace-nowrap"
          >
            <Icon size={14} className={tool.color} />
            {tool.label}
          </button>
        )
      })}
    </div>
  )
}
