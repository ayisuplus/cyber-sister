import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Bell, Plus, Trash2, Clock, Pause, Play } from 'lucide-react'
import { useToolsStore } from '../stores/toolsStore'
import Header from '../components/layout/Header'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'

const FREQ_OPTIONS = [
  { value: 'once', label: '一次性' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
]
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

function describeReminder(r) {
  if (r.freq === 'once' && r.nextFireAt) return format(new Date(r.nextFireAt), 'yyyy-MM-dd HH:mm')
  if (r.freq === 'daily') return `每天 ${r.time}`
  if (r.freq === 'weekly') return `每周${(r.weekdays ?? []).map((d) => WEEKDAY_LABELS[d]).join('、')} ${r.time}`
  if (r.freq === 'monthly') return `每月 ${r.monthDay} 号 ${r.time}`
  return ''
}

const INITIAL_FORM = { content: '', freq: 'once', date: '', time: '', monthDay: 1, weekdays: [] }

export default function ReminderPage() {
  const {
    scheduledReminders, loadScheduledReminders,
    addScheduledReminder, updateScheduledReminder, removeScheduledReminder,
  } = useToolsStore()
  const [form, setForm] = useState(INITIAL_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { loadScheduledReminders() }, [loadScheduledReminders])

  const toggleWeekday = (day) => {
    setForm((f) => ({
      ...f,
      weekdays: f.weekdays.includes(day) ? f.weekdays.filter((d) => d !== day) : [...f.weekdays, day],
    }))
  }

  const submit = async () => {
    setError('')
    if (!form.content.trim()) { setError('先写点提醒内容吧'); return }
    if (!form.time) { setError('选一个时间'); return }
    if (form.freq === 'once' && !form.date) { setError('一次性提醒要选日期'); return }
    if (form.freq === 'weekly' && form.weekdays.length === 0) { setError('每周提醒至少选一天'); return }

    const payload = { content: form.content.trim(), freq: form.freq, time: form.time }
    if (form.freq === 'once') payload.date = form.date
    if (form.freq === 'weekly') payload.weekdays = form.weekdays
    if (form.freq === 'monthly') payload.monthDay = form.monthDay

    setSubmitting(true)
    try {
      await addScheduledReminder(payload)
      setForm(INITIAL_FORM)
    } catch (err) {
      setError(err?.response?.data?.error ?? '保存失败，再试一次')
    } finally {
      setSubmitting(false)
    }
  }

  const sorted = [...scheduledReminders].sort((a, b) => new Date(a.nextFireAt) - new Date(b.nextFireAt))

  return (
    <div className="flex h-full flex-col">
      <Header title="自定义提醒" showBack />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {sorted.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="还没有自定义提醒"
            description="比如「周五下班取快递」「每天 23 点放下手机」，也可以直接在聊天里告诉 Amie。"
          />
        ) : (
          <Card>
            {sorted.map((r) => (
              <div
                key={r.id}
                className={`flex items-center gap-3 px-4 py-3 border-b border-border-subtle last:border-0 ${r.status !== 'active' ? 'opacity-60' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${r.status === 'done' ? 'text-text-muted line-through' : 'text-text-primary'}`}>
                    {r.content}
                  </p>
                  <span className="text-xs text-text-muted flex items-center gap-1 mt-0.5">
                    <Clock size={10} />
                    {describeReminder(r)}
                    {r.status === 'paused' && ' · 已暂停'}
                    {r.status === 'done' && ' · 已完成'}
                  </span>
                </div>
                {r.status !== 'done' && (
                  <button
                    type="button"
                    onClick={() => updateScheduledReminder(r.id, { status: r.status === 'active' ? 'paused' : 'active' })}
                    aria-label={r.status === 'active' ? `暂停提醒：${r.content}` : `恢复提醒：${r.content}`}
                    className="text-text-muted hover:text-action-primary transition-colors"
                  >
                    {r.status === 'active' ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeScheduledReminder(r.id)}
                  aria-label={`删除提醒：${r.content}`}
                  className="text-text-muted hover:text-danger transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </Card>
        )}
      </div>

      <div className="shrink-0 border-t border-border-hairline bg-surface-card px-4 py-3 space-y-3">
        <div className="flex gap-2">
          {FREQ_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setForm((f) => ({ ...f, freq: opt.value }))}
              className={`flex-1 rounded-xl py-2 text-xs font-semibold transition-colors ${
                form.freq === opt.value ? 'bg-action-primary text-text-inverse' : 'bg-surface-muted text-text-secondary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="text"
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            placeholder="提醒内容，比如：取快递"
            maxLength={200}
            aria-label="提醒内容"
            className="flex-1 min-w-40 rounded-xl border border-border-default bg-surface-input px-3 py-2 text-sm text-text-primary"
          />
          {form.freq === 'once' && (
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              aria-label="提醒日期"
              className="rounded-xl border border-border-default bg-surface-input px-3 py-2 text-sm text-text-primary"
            />
          )}
          <input
            type="time"
            value={form.time}
            onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
            aria-label="提醒时间"
            className="rounded-xl border border-border-default bg-surface-input px-3 py-2 text-sm text-text-primary"
          />
          {form.freq === 'monthly' && (
            <select
              value={form.monthDay}
              onChange={(e) => setForm((f) => ({ ...f, monthDay: Number(e.target.value) }))}
              aria-label="每月几号"
              className="rounded-xl border border-border-default bg-surface-input px-3 py-2 text-sm text-text-primary"
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d} 号</option>
              ))}
            </select>
          )}
        </div>

        {form.freq === 'weekly' && (
          <div className="flex gap-1.5" role="group" aria-label="选择星期">
            {WEEKDAY_LABELS.map((label, day) => (
              <button
                key={day}
                type="button"
                onClick={() => toggleWeekday(day)}
                aria-pressed={form.weekdays.includes(day)}
                className={`flex-1 rounded-lg py-1.5 text-xs transition-colors ${
                  form.weekdays.includes(day) ? 'bg-action-primary text-text-inverse' : 'bg-surface-muted text-text-secondary'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <Button onClick={submit} disabled={submitting} className="w-full">
          <Plus size={16} className="mr-1 inline" /> 添加提醒
        </Button>
      </div>
    </div>
  )
}
