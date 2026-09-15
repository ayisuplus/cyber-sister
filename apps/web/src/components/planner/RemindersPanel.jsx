import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Bell, Plus, Trash2, Clock, Pause, Play } from 'lucide-react'
import { useToolsStore } from '../../stores/toolsStore'
import Button from '../ui/Button'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'

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

const INITIAL_FORM = { content: '', freq: 'once', date: '', time: '', monthDay: 1, weekdays: [], isTask: false, instruction: '' }

// 提醒面板：原 ReminderPage 主体，挂在 PlannerPage 的「提醒」页签下
export default function RemindersPanel() {
  const {
    scheduledReminders, loadScheduledReminders,
    addScheduledReminder, updateScheduledReminder, removeScheduledReminder,
  } = useToolsStore()
  const [form, setForm] = useState(INITIAL_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  const [mutating, setMutating] = useState(null)

  useEffect(() => {
    let alive = true
    setLoadError('')
    loadScheduledReminders().catch(() => { if (alive) setLoadError('提醒加载失败，请重试') })
    return () => { alive = false }
  }, [loadScheduledReminders, reloadTick])

  const mutateReminder = async (id, payload) => {
    if (mutating) return
    setMutating(id); setError('')
    try {
      if (payload) await updateScheduledReminder(id, payload)
      else await removeScheduledReminder(id)
    } catch { setError('提醒操作失败，记录已保留，请重试') }
    finally { setMutating(null) }
  }

  const toggleWeekday = (day) => {
    setForm((f) => ({
      ...f,
      weekdays: f.weekdays.includes(day) ? f.weekdays.filter((d) => d !== day) : [...f.weekdays, day],
    }))
  }

  const submit = async () => {
    if (submitting) return
    setError('')
    if (!form.content.trim()) { setError(form.isTask ? '先给任务起个名字吧' : '先写点提醒内容吧'); return }
    if (!form.time) { setError('选一个时间'); return }
    if (form.freq === 'once' && !form.date) { setError('一次性提醒要选日期'); return }
    if (form.freq === 'weekly' && form.weekdays.length === 0) { setError('每周提醒至少选一天'); return }
    if (form.isTask && !form.instruction.trim()) { setError('任务要告诉 Amie 具体做什么'); return }

    const payload = { content: form.content.trim(), freq: form.freq, time: form.time }
    if (form.freq === 'once') payload.date = form.date
    if (form.freq === 'weekly') payload.weekdays = form.weekdays
    if (form.freq === 'monthly') payload.monthDay = form.monthDay
    if (form.isTask) payload.instruction = form.instruction.trim()

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

  const sorted = [...scheduledReminders].sort((a, b) => new Date(a.nextFireAt).getTime() - new Date(b.nextFireAt).getTime())

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {loadError && <div><p role="alert" className="text-sm text-danger">{loadError}</p><Button variant="secondary" onClick={() => setReloadTick(tick => tick + 1)}>重新加载提醒</Button></div>}
        {sorted.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="还没有自定义提醒"
            description="比如「周五下班取快递」「每天 23 点放下手机」，在下面设好时间就能保存。"
          />
        ) : (
          <Card>
            {sorted.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle last:border-0"
              >
                <div className="flex-1 min-w-0">
                  <p title={r.content} className={`text-sm truncate ${r.status === 'done' ? 'text-text-muted line-through' : 'text-text-primary'}`}>
                    {r.instruction && (
                      <span className="mr-1 inline-block rounded-md bg-pastel-apricot px-1.5 py-0.5 text-[10px] font-semibold text-status-warning">任务</span>
                    )}
                    {r.content}
                  </p>
                  <span className="text-xs text-text-muted flex items-center gap-1 mt-0.5">
                    <Clock size={10} />
                    {describeReminder(r)}
                    {r.status === 'paused' && ' · 已暂停'}
                    {r.status === 'done' && ' · 已完成'}
                  </span>
                  {r.instruction && (
                    <>
                      <p className="mt-0.5 text-xs text-text-muted truncate" title={r.instruction}>指令：{r.instruction}</p>
                      {r.status !== 'done' && <p className="mt-1 text-xs text-text-secondary">云端执行未接通 · 暂不执行</p>}
                    </>
                  )}
                </div>
                {r.status !== 'done' && (
                  <button
                    type="button"
                    onClick={() => mutateReminder(r.id, { status: r.status === 'active' ? 'paused' : 'active' })}
                    disabled={mutating !== null}
                    aria-label={r.status === 'active' ? `暂停提醒：${r.content}` : `恢复提醒：${r.content}`}
                    className="-my-1.5 flex h-11 w-11 shrink-0 items-center justify-center text-text-muted transition-colors hover:text-action-primary"
                  >
                    {r.status === 'active' ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => mutateReminder(r.id)}
                  disabled={mutating !== null}
                  aria-label={`删除提醒：${r.content}`}
                  className="-my-1.5 flex h-11 w-11 shrink-0 items-center justify-center text-text-muted transition-colors hover:text-danger"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </Card>
        )}
      </div>

      <div className="shrink-0 border-t border-border-hairline bg-surface-card px-4 py-3 space-y-3">
        <div className="flex gap-2" role="group" aria-label="类型">
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, isTask: false }))}
            className={`flex-1 rounded-xl py-2 text-xs font-semibold transition-colors ${
              !form.isTask ? 'bg-action-primary text-text-inverse' : 'bg-surface-muted text-text-secondary'
            }`}
          >
            提醒（到点通知我）
          </button>
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, isTask: true }))}
            className={`flex-1 rounded-xl py-2 text-xs font-semibold transition-colors ${
              form.isTask ? 'bg-action-primary text-text-inverse' : 'bg-surface-muted text-text-secondary'
            }`}
          >
            任务（Amie 到点去做）
          </button>
        </div>
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
            placeholder={form.isTask ? '任务名，比如：每周日记总结' : '提醒内容，比如：取快递'}
            maxLength={200}
            aria-label={form.isTask ? '任务名' : '提醒内容'}
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

        {form.isTask && (
          <textarea
            value={form.instruction}
            onChange={(e) => setForm((f) => ({ ...f, instruction: e.target.value }))}
            placeholder="告诉 Amie 到点要做什么，比如：读读我这周的日记，给我一段温暖的总结"
            maxLength={500}
            rows={2}
            aria-label="任务指令"
            className="w-full rounded-xl border border-border-default bg-surface-input px-3 py-2 text-sm text-text-primary"
          />
        )}

        {form.freq === 'weekly' && (          <div className="flex gap-1.5" role="group" aria-label="选择星期">
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

        {form.isTask && <p className="text-xs text-status-info">可以保存任务安排；云端执行尚未接通，到点不会自动执行。</p>}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <Button onClick={submit} disabled={submitting} className="w-full">
          <Plus size={16} className="mr-1 inline" /> 添加提醒
        </Button>
      </div>
    </div>
  )
}
