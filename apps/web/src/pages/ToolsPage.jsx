import { Link } from 'react-router-dom'
import { Bell, BookHeart, BookOpen, CalendarHeart, Camera, ChevronRight, GraduationCap, ListTodo, NotebookPen, Shirt, Sparkles, Timer, WandSparkles } from 'lucide-react'
import Header from '../components/layout/Header'
import TabBar from '../components/layout/TabBar'
import { CAPABILITIES } from '../features/capabilities'

const ICONS = {
  sparkles: Sparkles,
  shirt: Shirt,
  wand: WandSparkles,
  camera: Camera,
}

const TOOLBOX = [
  {
    id: 'period',
    title: '大姨妈记录',
    description: '记下经期，帮你推算下次大概什么时候来。',
    to: '/tools/period',
    icon: CalendarHeart,
    tone: 'bg-pastel-blush text-action-primary',
  },
  {
    id: 'countdown',
    title: '倒数日',
    description: '重要的日子还有几天，一眼就能看到。',
    to: '/tools/countdown',
    icon: Timer,
    tone: 'bg-pastel-apricot text-action-primary',
  },
  {
    id: 'todo',
    title: '日程',
    description: '把要做的事按天排好，今天做什么一眼看清。',
    to: '/tools/todo',
    icon: ListTodo,
    tone: 'bg-pastel-sprout text-status-local',
  },
  {
    id: 'diary',
    title: '日记',
    description: '写下今天的心情，姐妹会认真回应你。',
    to: '/tools/diary',
    icon: BookHeart,
    tone: 'bg-pastel-blush text-action-primary',
  },
  {
    id: 'handbook',
    title: '手帐打卡',
    description: '小习惯每天打卡，看看能坚持多久。',
    to: '/tools/handbook',
    icon: NotebookPen,
    tone: 'bg-pastel-apricot text-action-primary',
  },
  {
    id: 'reminders',
    title: '提醒设置',
    description: '喝水、睡觉和大姨妈提醒，都在设置里开关。',
    to: '/settings',
    icon: Bell,
    tone: 'bg-pastel-mist text-status-info',
  },
  {
    id: 'reading',
    title: '一起读书',
    description: '在读的书和感想，姐妹会陪你聊。',
    to: '/tools/reading',
    icon: BookOpen,
    tone: 'bg-pastel-mist text-status-info',
  },
  {
    id: 'study',
    title: '专注自习',
    description: '定个番茄钟，姐妹安静陪你学。',
    to: '/tools/study',
    icon: GraduationCap,
    tone: 'bg-pastel-sprout text-status-local',
  },
]

const TONES = {
  apricot: 'bg-pastel-apricot text-action-primary',
  mist: 'bg-pastel-mist text-status-info',
  blush: 'bg-pastel-blush text-action-primary',
  sprout: 'bg-pastel-sprout text-status-local',
}

function CapabilityContent({ capability }) {
  const Icon = ICONS[capability.icon]
  const available = capability.status === 'available'

  return (
    <>
      <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${TONES[capability.tone]}`} aria-hidden="true">
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
      <TabBar />
    </div>
  )
}
