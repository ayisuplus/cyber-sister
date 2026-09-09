import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import Header from '../components/layout/Header'
import CareCards from '../components/care/CareCards'
import { CAPABILITIES } from '../features/capabilities'
import { CAPABILITY_ICONS, CAPABILITY_TONES, TOOLBOX } from '../features/toolbox'

function CapabilityContent({ capability }) {
  const Icon = CAPABILITY_ICONS[capability.icon]
  const available = capability.status === 'available'

  return (
    <>
      <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${CAPABILITY_TONES[capability.tone]}`} aria-hidden="true">
        <Icon size={23} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-text-primary">{capability.title}</h2>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${available ? 'bg-pastel-sprout text-status-local' : 'bg-surface-muted text-text-muted'}`}>
            {available ? '可使用' : '规划中'}
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-text-secondary">{capability.description}</p>
        {capability.privacyNote && <p className="mt-3 text-[11px] font-medium text-status-local">{capability.privacyNote}</p>}
      </div>
      {available && <ChevronRight size={17} className="shrink-0 text-action-primary" aria-hidden="true" />}
    </>
  )
}

export default function ToolsPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-transparent">
      <Header title="发现" />
      <main className="flex-1 overflow-y-auto px-4 py-5">
        <div className="mb-4">
          <CareCards />
        </div>
        <section className="flex items-center gap-4 rounded-3xl bg-gradient-pastel p-5 border border-border-hairline">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-status-info">本地能力空间</p>
            <h1 className="mt-2 text-xl font-bold text-text-primary">在这台设备上完成</h1>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">这里集中承载需要图像或设备能力的独立模块。只有标记为“可使用”的功能可以进入。</p>
          </div>
          <img src="/design-assets/banner-tools.png" alt="" loading="lazy" className="h-24 w-24 shrink-0 rounded-2xl object-cover min-[641px]:h-32 min-[641px]:w-32" onError={event => { event.currentTarget.style.display = 'none' }} />
        </section>

        <div className="mt-4 grid gap-3 min-[641px]:grid-cols-2">
          {CAPABILITIES.map(capability => {
            if (capability.status !== 'available') {
              return (
                <article key={capability.id} aria-disabled="true" className="flex min-h-28 items-center gap-4 rounded-3xl border border-border-hairline bg-surface-card p-4 opacity-70">
                  <CapabilityContent capability={capability} />
                </article>
              )
            }
            const linkClass = 'hover-lift flex min-h-28 items-center gap-4 rounded-3xl bg-surface-card p-4 border border-border-hairline transition-colors hover:bg-pastel-apricot focus:outline-none focus:ring-2 focus:ring-status-info'
            // 全部为 SPA 内部路由，用 Link 避免刷新
            return (
              <Link key={capability.id} to={capability.href} className={linkClass}>
                <CapabilityContent capability={capability} />
              </Link>
            )
          })}
        </div>
        <section className="mt-6">
          <h2 className="px-1 text-xs font-semibold text-text-muted">姐妹工具箱</h2>
          <div className="mt-3 grid gap-3 min-[641px]:grid-cols-2">
            {TOOLBOX.map(tool => {
              const Icon = tool.icon
              return (
                <Link key={tool.id} to={tool.to} className="hover-lift flex items-center gap-4 rounded-3xl bg-surface-card p-4 border border-border-hairline transition-colors hover:bg-pastel-apricot focus:outline-none focus:ring-2 focus:ring-status-info">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${tool.tone}`} aria-hidden="true">
                    <Icon size={23} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold text-text-primary">{tool.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-text-secondary">{tool.description}</p>
                  </div>
                  <ChevronRight size={17} className="shrink-0 text-text-muted" aria-hidden="true" />
                </Link>
              )
            })}
          </div>
        </section>
      </main>
    </div>
  )
}
