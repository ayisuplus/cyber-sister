import { useEffect, useState } from 'react'
import { useToolsStore } from '../stores/toolsStore'
import Header from '../components/layout/Header'
import { Plus, Trash2, Timer } from 'lucide-react'
import { differenceInDays } from 'date-fns'

export default function CountdownPage() {
  const { countdowns, addCountdown, deleteCountdown } = useToolsStore()
  const loadCountdowns = useToolsStore(s => s.loadCountdowns)
  const [showForm, setShowForm] = useState(false)
  useEffect(() => {
    loadCountdowns()
  }, [loadCountdowns])
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')

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
    <div className="flex-1 flex flex-col bg-surface-page overflow-hidden">
      <Header title="倒数日" showBack />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {countdowns.length === 0 ? (
          <div className="text-center py-12">
            <Timer size={48} className="text-text-muted mx-auto mb-3" />
            <p className="text-text-muted text-sm">暂无倒数日</p>
          </div>
        ) : (
          <div className="space-y-3">
            {countdowns.map(cd => {
              const targetDate = new Date(cd.targetDate)
              const daysLeft = differenceInDays(targetDate, today)
              const isPast = daysLeft < 0

              return (
                <div key={cd.id} className="bg-white rounded-[20px] p-4 shadow-card">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-text-primary">{cd.title}</h3>
                      <p className="text-xs text-text-muted mt-1">{cd.targetDate}</p>
                    </div>
                    <button
                      onClick={() => deleteCountdown(cd.id)}
                      className="text-text-muted hover:text-red-500 transition-colors"
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
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 添加表单 */}
      <div className="px-4 py-3 bg-white shadow-input">
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
              <button onClick={handleAdd} className="flex-1 h-10 bg-brand-pink text-white text-sm rounded-xl">
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
