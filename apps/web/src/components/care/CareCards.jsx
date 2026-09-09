import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, CalendarHeart, CloudRain, Flame, Gift, Heart, ListTodo, Sparkles, X } from 'lucide-react'
import { careService } from '../../services/careService'

const KIND_META = {
  birthday: { icon: Gift, tone: 'bg-pastel-blush text-action-primary' },
  period: { icon: Heart, tone: 'bg-pastel-blush text-danger' },
  countdown: { icon: CalendarHeart, tone: 'bg-pastel-apricot text-status-warning' },
  'todo-overdue': { icon: ListTodo, tone: 'bg-pastel-mist text-status-info' },
  'todo-today': { icon: ListTodo, tone: 'bg-pastel-mist text-status-info' },
  habit: { icon: Flame, tone: 'bg-pastel-sprout text-status-local' },
  study: { icon: BookOpen, tone: 'bg-pastel-mist text-status-info' },
  mood: { icon: CloudRain, tone: 'bg-pastel-mist text-status-info' },
}

// 「她来想你」主动关怀卡：只发有用的，每条都附「为什么看到这条」并可按日忽略；
// 加载失败/为空一律静默不渲染，绝不用假数据占位。
export default function CareCards({ limit = 3, heading = true }) {
  const [cards, setCards] = useState([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    careService.list()
      .then((data) => { if (alive) setCards(Array.isArray(data?.touchpoints) ? data.touchpoints : []) })
      .catch(() => { if (alive) setCards([]) })
      .finally(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [])

  const dismiss = (key) => {
    // 乐观移除；忽略失败不打扰——明日同一条件成立时它自然会再来
    setCards((current) => current.filter((card) => card.key !== key))
    careService.dismiss(key).catch(() => {})
  }

  const visible = cards.slice(0, limit)
  if (!loaded || visible.length === 0) return null

  return (
    <section aria-label="她来想你" className="space-y-2">
      {heading && <h2 className="px-1 text-xs font-semibold text-text-muted">她来想你</h2>}
      {visible.map((card) => {
        const meta = KIND_META[card.kind] || { icon: Sparkles, tone: 'bg-pastel-mist text-status-info' }
        const Icon = meta.icon
        return (
          <article key={card.key} className="rounded-3xl border border-border-hairline bg-surface-card p-4">
            <div className="flex items-start gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${meta.tone}`} aria-hidden="true">
                <Icon size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-text-primary">{card.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-text-secondary">{card.body}</p>
                <p className="mt-2 text-[11px] text-text-muted">为什么看到这条：{card.reason}</p>
                {card.action && (
                  <Link to={card.action.to} className="mt-1 inline-flex min-h-11 items-center text-xs font-semibold text-action-primary">
                    {card.action.label} →
                  </Link>
                )}
              </div>
              <button
                type="button"
                aria-label="今天不再提醒这条"
                onClick={() => dismiss(card.key)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-text-muted hover:bg-surface-muted"
              >
                <X size={15} />
              </button>
            </div>
          </article>
        )
      })}
    </section>
  )
}
