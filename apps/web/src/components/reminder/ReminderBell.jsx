import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, X } from 'lucide-react'
import { useToolsStore } from '../../stores/toolsStore'

const FREQ_LABELS = { once: '一次性', daily: '每天', weekly: '每周', monthly: '每月' }

function describeDelivery(delivery) {
  const r = delivery.reminder ?? {}
  const when = new Date(delivery.fireAt)
  const hhmm = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
  return `你设置的提醒：${FREQ_LABELS[r.freq] ?? ''} ${r.time ?? hhmm}`
}

/**
 * 自定义提醒通知中心：挂在侧栏品牌区右侧。
 * 前台每 60s + 页面重新可见时拉取 /reminders/due；无推送通道。
 * 加载失败静默（badge 不显示），绝不用假数据。
 */
export default function ReminderBell() {
  const dueDeliveries = useToolsStore(s => s.dueDeliveries)
  const pollDueDeliveries = useToolsStore(s => s.pollDueDeliveries)
  const ackDelivery = useToolsStore(s => s.ackDelivery)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    pollDueDeliveries()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') pollDueDeliveries()
    }, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') pollDueDeliveries() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [pollDueDeliveries])

  // 点击面板外关闭
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const pending = dueDeliveries.length

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        aria-label={pending > 0 ? `提醒，${pending} 条待处理` : '提醒'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl text-text-secondary hover:bg-surface-muted transition-colors"
      >
        <Bell size={19} />
        {pending > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-action-primary px-1 text-[10px] font-semibold text-text-inverse"
          >
            {pending > 9 ? '9+' : pending}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-3xl border border-border-hairline bg-surface-card p-3 shadow-lg">
          <div className="flex items-center justify-between px-1 pb-2">
            <h2 className="text-xs font-semibold text-text-muted">到点提醒</h2>
            <Link to="/tools/reminders" onClick={() => setOpen(false)} className="text-xs text-action-primary hover:underline">
              管理提醒
            </Link>
          </div>
          {pending === 0 ? (
            <p className="px-1 py-4 text-center text-sm text-text-muted">没有到点的提醒</p>
          ) : (
            <ul className="space-y-2" aria-label="到期提醒列表">
              {dueDeliveries.map((delivery) => (
                <li key={delivery.id} className="rounded-2xl border border-border-hairline bg-pastel-blush p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-text-primary">{delivery.reminder?.content}</p>
                      <p className="mt-0.5 text-xs text-text-muted">{describeDelivery(delivery)}</p>
                    </div>
                    <button
                      type="button"
                      aria-label={`忽略提醒「${delivery.reminder?.content}」`}
                      onClick={() => ackDelivery(delivery.id, 'dismissed')}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-card"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => ackDelivery(delivery.id, 'shown')}
                    className="mt-2 w-full rounded-xl bg-action-primary py-1.5 text-xs font-semibold text-text-inverse hover:bg-action-hover transition-colors"
                  >
                    知道了
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
