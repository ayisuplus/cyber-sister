import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { CAPABILITIES } from '../../features/capabilities'
import { CAPABILITY_ICONS, CAPABILITY_TONES, TOOLBOX } from '../../features/toolbox'

// 工作模式功能桌面：全部功能入口的唯一网格（空态直出 + 头部按钮唤出共用）。
// 数据源 = CAPABILITIES（status available 的图像/设备能力）+ TOOLBOX（姐妹工具箱）。
const CARDS = [
  ...CAPABILITIES.filter(c => c.status === 'available').map(c => ({
    id: c.id,
    title: c.title,
    description: c.description,
    to: c.href,
    icon: CAPABILITY_ICONS[c.icon],
    tone: CAPABILITY_TONES[c.tone],
  })),
  ...TOOLBOX,
]

function DesktopGrid() {
  return (
    <nav aria-label="功能桌面">
      <h2 className="px-1 text-xs font-semibold text-text-muted">做点什么好呢</h2>
      <div className="mt-3 grid gap-3 min-[641px]:grid-cols-2">
        {CARDS.map(card => {
          const Icon = card.icon
          return (
            <Link key={card.id} to={card.to} className="hover-lift flex items-center gap-4 rounded-3xl bg-surface-card p-4 border border-border-hairline transition-colors hover:bg-pastel-apricot focus:outline-none focus:ring-2 focus:ring-status-info">
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${card.tone}`} aria-hidden="true">
                <Icon size={23} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-text-primary">{card.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-text-secondary">{card.description}</p>
              </div>
              <ChevronRight size={17} className="shrink-0 text-text-muted" aria-hidden="true" />
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
/** @param {{ onClose?: () => void }} [props] */
export default function WorkDesktop({ onClose } = {}) {
  if (!onClose) return <DesktopGrid />
  return (
    <div className="absolute inset-0 z-50" role="dialog" aria-modal="true" aria-label="功能桌面">
      <button type="button" aria-label="关闭功能桌面" onClick={onClose} className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative mx-auto mt-16 max-h-[75vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-surface-card p-5 shadow-xl">
        <DesktopGrid />
        <button
          type="button"
          onClick={onClose}
          className="mt-4 flex min-h-11 w-full items-center justify-center rounded-2xl border border-border-default bg-surface-card text-sm font-semibold text-text-secondary"
        >
          关闭
        </button>
      </div>
    </div>
  )
}
