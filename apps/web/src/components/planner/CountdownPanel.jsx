import { useEffect, useState } from 'react'
import { useToolsStore } from '../../stores/toolsStore'
import Button from '../ui/Button'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'
import { Plus, Trash2, Timer } from 'lucide-react'
import { differenceInCalendarDays, parseISO } from 'date-fns'

// 倒数日面板：原 CountdownPage 主体，挂在 PlannerPage 的「倒数日」页签下
export default function CountdownPanel() {
  const { countdowns, addCountdown, deleteCountdown } = useToolsStore()
  const loadCountdowns = useToolsStore(s => s.loadCountdowns)
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true); setLoadError('')
    loadCountdowns()
      .catch(() => { if (alive) setLoadError('加载失败，请检查网络后重试') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [loadCountdowns, reloadTick])

  const handleAdd = async () => {
    if (!title.trim() || !date || saving) return
    setSaving(true); setActionError('')
    try {
      await addCountdown(title.trim(), date)
      setTitle(''); setDate(''); setShowForm(false)
    } catch (error) { setActionError(error?.response?.data?.error || '保存失败，输入已保留，请重试') }
    finally { setSaving(false) }
  }

  const handleDelete = async (id) => {
    if (deletingId) return
    setDeletingId(id); setActionError('')
    try { await deleteCountdown(id) }
    catch { setActionError('删除失败，请重试') }
    finally { setDeletingId(null) }
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {actionError && <p role="alert" className="text-sm text-danger">{actionError}</p>}
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
              const targetDate = parseISO(cd.targetDate.slice(0, 10))
              const daysLeft = differenceInCalendarDays(targetDate, today)
              const isPast = daysLeft < 0

              return (
                <Card key={cd.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-text-primary">{cd.title}</h3>
                      <p className="text-xs text-text-muted mt-1">{cd.targetDate.slice(0, 10)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(cd.id)}
                      disabled={deletingId !== null}
                      aria-label={`删除倒数日 ${cd.title}`}
                      className="-my-1.5 flex h-11 w-11 shrink-0 items-center justify-center text-text-muted transition-colors hover:text-danger"
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
              aria-label="倒数日名称"
              maxLength={100}
              className="w-full min-h-11 bg-surface-input rounded-xl px-4 text-sm outline-none"
            />
            <input
              type="date"
              aria-label="倒数日日期"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full min-h-11 bg-surface-input rounded-xl px-4 text-sm outline-none"
            />
            <div className="flex gap-2">
              <button type="button" onClick={handleAdd} disabled={saving || !title.trim() || !date} className="flex-1 min-h-11 bg-brand-pink text-text-inverse text-sm rounded-xl disabled:opacity-50">
                添加
              </button>
              <button type="button" disabled={saving} onClick={() => setShowForm(false)} className="min-h-11 px-4 text-text-muted text-sm">
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="w-full min-h-11 bg-brand-pink/10 text-brand-pink text-sm font-medium rounded-xl flex items-center justify-center gap-1"
          >
            <Plus size={16} />
            添加倒数日
          </button>
        )}
      </div>
    </div>
  )
}
