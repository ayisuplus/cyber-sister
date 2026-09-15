import { Menu, Sparkles, Settings } from 'lucide-react'
import { Link } from 'react-router-dom'

// 只有一种对话：页头只放她的名字、AI 标识与设置入口，没有模式切换
export default function ChatHeader({ onOpenDrawer }) {
  return (
    <>
      {/* AI 身份常驻条：位置、高度与文案不变，只换成半透明雾色 */}
      <div className="glass-mist relative z-10 flex h-8 shrink-0 items-center justify-center text-xs">
        <span className="flex items-center gap-1.5 text-text-secondary">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-surface-card text-status-info" aria-hidden="true">
            <Sparkles size={10} />
          </span>
          这是 AI，不是真人
        </span>
      </div>

      <div className="glass-bar relative z-10 flex h-16 shrink-0 items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <button type="button" aria-label="打开会话列表" onClick={onOpenDrawer} className="flex h-11 w-11 items-center justify-center rounded-full text-text-primary transition-colors duration-300 ease-calm hover:bg-surface-muted min-[641px]:hidden">
            <Menu size={22} aria-hidden="true" />
          </button>
          {/* 不放"在线"圆点：V3.0 禁止虚假在线状态与真人暗示 */}
          <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-pastel-blush font-display text-lg italic text-action-primary shadow-soft ring-1 ring-border-hairline">
            <span aria-hidden="true">A</span>
            <img src="/design-assets/ai-avatar-v2.png" alt="Amie AI" className="absolute inset-0 h-full w-full object-cover" onError={event => { event.currentTarget.style.display = 'none' }} />
          </div>

          {/* 只写她的名字；说话方式在「她」页面里选，不在页头展示 */}
          <div className="flex flex-col">
            <h2 className="font-display text-[18px] font-normal italic leading-tight tracking-[0.02em] text-text-primary">Amie</h2>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden whitespace-nowrap rounded-full bg-pastel-mist px-3 py-1.5 text-[10px] font-medium text-status-info min-[641px]:inline-flex">AI 生成 · 云端模型</span>
          <Link to="/settings" aria-label="打开设置" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors duration-300 ease-calm hover:bg-surface-muted"><Settings size={19} aria-hidden="true" /></Link>
        </div>
      </div>
    </>
  )
}
