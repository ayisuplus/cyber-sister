import { useEffect, useState } from 'react'
import { useToolsStore } from '../stores/toolsStore'
import Header from '../components/layout/Header'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import { Plus, Trash2, Timer } from 'lucide-react'
import { differenceInDays } from 'date-fns'

export default function CountdownPage() {
  const { countdowns, addCountdown, deleteCountdown } = useToolsStore()
  const loadCountdowns = useToolsStore(s => s.loadCountdowns)
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true); setLoadError('')
    loadCountdowns()
      .catch(() => { if (alive) setLoadError('加载失败，请检查网络后重试') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [loadCountdowns, reloadTick])

  const handleAdd = () => {
    if (!title.trim() || !date) return
    addCountdown(title.trim(), date)
    setTitle('')
    setDate('')
    setShowForm(false)
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return (
    <div className="flex-1 flex flex-col bg-transparent overflow-hidden">
      <Header title="倒数日" showBack />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {loading ? (
          <p role="status" className="py-8 text-center text-sm text-text-muted">加载中…</p>
        ) : loadError ? (
          <div className="py-8 text-center">
            <p role="alert" className="text-sm text-danger">{loadError}</p>
            <Button variant="secondary" className="mt-3" onClick={() => setReloadTick(tick => tick + 1)}>重试</Button>
          </div>
        ) : countdowns.length === 0 ? (
          <EmptyState icon={Timer} title="暂无倒数日" />
        ) : (
          <div className="space-y-3">
            {countdowns.map(cd => {
              const targetDate = new Date(cd.targetDate)
              const daysLeft = differenceInDays(targetDate, today)
              const isPast = daysLeft < 0

              return (
                <Card key={cd.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-text-primary">{cd.title}</h3>
                      <p className="text-xs text-text-muted mt-1">{cd.targetDate}</p>
                    </div>
                    <button
                      onClick={() => deleteCountdown(cd.id)}
                      className="text-text-muted hover:text-danger transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="mt-3 text-center">
                    {isPast ? (
                      <span className="text-lg font-mono font-bold text-text-muted">
                        已过 {Math.abs(daysLeft)} 天
                      </span>
                    ) : (
                      <>
                        <span className="text-4xl font-mono font-bold text-brand-pink">{daysLeft}</span>
                        <p className="text-xs text-text-muted mt-1">天后</p>
                      </>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* 添加表单 */}
      <div className="px-4 py-3 bg-surface-card shadow-input">
        {showForm ? (
          <div className="space-y-2">
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="倒数日名称"
              className="w-full h-10 bg-surface-input rounded-xl px-4 text-sm outline-none"
            />
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full h-10 bg-surface-input rounded-xl px-4 text-sm outline-none"
            />
            <div className="flex gap-2">
              <button onClick={handleAdd} className="flex-1 h-10 bg-brand-pink text-text-inverse text-sm rounded-xl">
                添加
              </button>
              <button onClick={() => setShowForm(false)} className="h-10 px-4 text-text-muted text-sm">
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full h-10 bg-brand-pink/10 text-brand-pink text-sm font-medium rounded-xl flex items-center justify-center gap-1"
          >
            <Plus size={16} />
            添加倒数日
          </button>
        )}
      </div>
    </div>
  )
}
