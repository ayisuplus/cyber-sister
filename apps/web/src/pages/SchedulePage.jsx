import { useEffect, useState } from 'react'
import { CalendarClock, Check, ChevronDown, Pause, Play, Plus, Trash2 } from 'lucide-react'
import Header from '../components/layout/Header'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import { useToolsStore } from '../stores/toolsStore'
import { DATED_FREQS, FREQ_OPTIONS, WEEKDAY_LABELS, daysLeft, daysLeftLabel, describeWhen, groupTasks } from '../features/schedule'

const SECTIONS = [
  { id: 'today', title: '今天' },
  { id: 'upcoming', title: '接下来' },
  { id: 'repeating', title: '重复' },
  { id: 'paused', title: '已暂停' },
]

const INITIAL_FORM = { content: '', freq: 'once', date: '', time: '', monthDay: 1, weekdays: [], isTask: false, instruction: '' }

const chip = (active) => `min-h-9 flex-1 rounded-full text-xs font-semibold transition-colors duration-300 ease-calm ${
  active ? 'bg-action-primary text-text-inverse' : 'bg-surface-muted text-text-secondary hover:bg-pastel-blush'
}`
const field = 'rounded-control border border-border-default bg-surface-input px-3 py-2 text-sm text-text-primary'
const iconButton = '-my-1.5 flex h-11 w-11 shrink-0 items-center justify-center text-text-muted transition-colors duration-300 ease-calm disabled:opacity-50'

function validate(form, now) {
  if (!form.content.trim()) return form.isTask ? '先给这件事起个名字吧' : '先写下要安排的事吧'
  if (!form.time) return '选一个时间'
  if (DATED_FREQS.includes(form.freq) && !form.date) return form.freq === 'once' ? '一次性的安排要选日期' : '每年的安排要选日期'
  if (form.freq === 'once' && new Date(`${form.date}T${form.time}`) <= now) return '这个时间已经过去了，换一个吧'
  if (form.freq === 'weekly' && form.weekdays.length === 0) return '每周至少选一天'
  if (form.isTask && !form.instruction.trim()) return '告诉她具体要做什么'
  return ''
}

function toPayload(form) {
  const payload = { content: form.content.trim(), freq: form.freq, time: form.time }
  if (DATED_FREQS.includes(form.freq)) payload.date = form.date
  if (form.freq === 'weekly') payload.weekdays = [...form.weekdays].sort()
  if (form.freq === 'monthly') payload.monthDay = form.monthDay
  if (form.isTask) payload.instruction = form.instruction.trim()
  return payload
}

function TaskForm({ onDone }) {
  const addTask = useToolsStore(s => s.addScheduledReminder)
  const [form, setForm] = useState(INITIAL_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (patch) => setForm(current => ({ ...current, ...patch }))
  const toggleWeekday = (day) => set({ weekdays: form.weekdays.includes(day) ? form.weekdays.filter(d => d !== day) : [...form.weekdays, day] })

  const submit = async (event) => {
    event.preventDefault()
    if (saving) return
    const message = validate(form, new Date())
    setError(message)
    if (message) return
    setSaving(true)
    try {
      await addTask(toPayload(form))
      onDone()
    } catch (err) {
      setError(err?.response?.data?.error ?? '保存失败，再试一次')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} aria-label="新安排" className="mx-auto max-w-3xl animate-reveal-up space-y-3">
      <div className="flex gap-2" role="group" aria-label="谁来做">
        <button type="button" aria-pressed={!form.isTask} onClick={() => set({ isTask: false })} className={chip(!form.isTask)}>到点提醒我</button>
        <button type="button" aria-pressed={form.isTask} onClick={() => set({ isTask: true })} className={chip(form.isTask)}>交给她去做</button>
      </div>
      <div className="flex gap-1.5" role="group" aria-label="多久一次">
        {FREQ_OPTIONS.map(option => (
          <button key={option.value} type="button" aria-pressed={form.freq === option.value} onClick={() => set({ freq: option.value })} className={chip(form.freq === option.value)}>
            {option.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={form.content}
          onChange={(e) => set({ content: e.target.value })}
          placeholder={form.isTask ? '起个名字，比如：每周日记总结' : '比如：周六复诊、妈妈生日、喝水'}
          maxLength={200}
          aria-label={form.isTask ? '这件事叫什么' : '要安排的事'}
          className={`min-w-40 flex-1 ${field}`}
        />
        {DATED_FREQS.includes(form.freq) && (
          <input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} aria-label="日期" className={field} />
        )}
        {form.freq === 'monthly' && (
          <select value={form.monthDay} onChange={(e) => set({ monthDay: Number(e.target.value) })} aria-label="每月几号" className={field}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map(day => <option key={day} value={day}>{day} 号</option>)}
          </select>
        )}
        <input type="time" value={form.time} onChange={(e) => set({ time: e.target.value })} aria-label="时间" className={field} />
      </div>

      {form.freq === 'weekly' && (
        <div className="flex gap-1.5" role="group" aria-label="选择星期">
          {WEEKDAY_LABELS.map((label, day) => (
            <button key={day} type="button" aria-pressed={form.weekdays.includes(day)} onClick={() => toggleWeekday(day)} className={chip(form.weekdays.includes(day))}>
              {label}
            </button>
          ))}
        </div>
      )}
      {form.freq === 'yearly' && <p className="text-xs text-text-muted">每年这一天都会提醒，适合生日和纪念日。</p>}

      {form.isTask && (
        <>
          <textarea
            value={form.instruction}
            onChange={(e) => set({ instruction: e.target.value })}
            placeholder="告诉她到点要做什么，比如：读读我这周的日记，给我一段温暖的总结"
            maxLength={500}
            rows={2}
            aria-label="要她做什么"
            className={`w-full ${field}`}
          />
          <p className="text-xs text-status-info">可以先存下来；云端执行还没接通，到点不会自动去做。</p>
        </>
      )}

      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onDone} className="flex-1">先不加</Button>
        <Button type="submit" disabled={saving} className="flex-1">保存安排</Button>
      </div>
    </form>
  )
}

function TaskRow({ task, now, upcoming, busy, onChange, onDelete }) {
  const done = task.status === 'done'
  return (
    <li className="flex items-center gap-3 border-b border-border-subtle px-4 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <p title={task.content} className={`truncate text-sm ${done ? 'text-text-muted line-through' : 'text-text-primary'}`}>
          {task.instruction && <span className="mr-1.5 inline-block rounded-md bg-pastel-apricot px-1.5 py-0.5 text-[10px] font-semibold text-status-warning">交给她</span>}
          {task.content}
        </p>
        <p className="mt-0.5 text-xs text-text-muted">{describeWhen(task, now)}</p>
        {task.instruction && !done && (
          <>
            <p title={task.instruction} className="mt-0.5 truncate text-xs text-text-muted">要她做：{task.instruction}</p>
            <p className="mt-1 text-xs text-text-secondary">云端执行未接通 · 到点暂不执行</p>
          </>
        )}
      </div>
      {upcoming && <span className="shrink-0 text-xs text-text-secondary">{daysLeftLabel(daysLeft(task, now))}</span>}
      {!done && task.freq === 'once' && (
        <button type="button" disabled={busy} onClick={() => onChange(task, { status: 'done' })} aria-label={`完成：${task.content}`} className={`${iconButton} hover:text-action-primary`}>
          <Check size={17} />
        </button>
      )}
      {!done && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onChange(task, { status: task.status === 'paused' ? 'active' : 'paused' })}
          aria-label={task.status === 'paused' ? `继续：${task.content}` : `暂停：${task.content}`}
          className={`${iconButton} hover:text-action-primary`}
        >
          {task.status === 'paused' ? <Play size={16} /> : <Pause size={16} />}
        </button>
      )}
      <button type="button" disabled={busy} onClick={() => onDelete(task)} aria-label={`删除：${task.content}`} className={`${iconButton} hover:text-danger`}>
        <Trash2 size={16} />
      </button>
    </li>
  )
}

// 安排：日程、倒数日、提醒和每天的小习惯合成的一处。到点由铃铛提醒；交给她的事如实标注暂不执行。
export default function SchedulePage() {
  const tasks = useToolsStore(s => s.scheduledReminders)
  const loadTasks = useToolsStore(s => s.loadScheduledReminders)
  const updateTask = useToolsStore(s => s.updateScheduledReminder)
  const removeTask = useToolsStore(s => s.removeScheduledReminder)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  const [mutating, setMutating] = useState(null)
  const [actionError, setActionError] = useState('')
  const [adding, setAdding] = useState(false)
  const [showDone, setShowDone] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true); setLoadError('')
    loadTasks()
      .catch(() => { if (alive) setLoadError('安排没加载出来，请重试') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [loadTasks, reloadTick])

  const mutate = async (task, payload) => {
    if (mutating) return
    setMutating(task.id); setActionError('')
    try {
      if (payload) await updateTask(task.id, payload)
      else await removeTask(task.id)
    } catch {
      setActionError('没改成功，记录还在，请重试')
    } finally {
      setMutating(null)
    }
  }

  const now = new Date()
  const groups = groupTasks(tasks, now)
  const rowProps = (task) => ({ task, now, busy: mutating !== null, onChange: mutate, onDelete: (target) => mutate(target) })

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header title="安排" showBack />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-4 py-4">
          {loadError && (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-danger">{loadError}</p>
              <Button variant="secondary" onClick={() => setReloadTick(tick => tick + 1)}>重新加载</Button>
            </div>
          )}
          {actionError && <p role="alert" className="text-sm text-danger">{actionError}</p>}
          {!loading && !loadError && tasks.length === 0 && (
            <EmptyState
              icon={CalendarClock}
              title="还没有安排"
              description="日程、倒数日、每天的小习惯都放在这里，到点我会轻轻提醒你。也可以在对话里直接说「明天九点提醒我复诊」。"
            />
          )}
          {SECTIONS.map(section => groups[section.id].length > 0 && (
            <section key={section.id} aria-labelledby={`schedule-${section.id}`} className="animate-reveal-up">
              <h2 id={`schedule-${section.id}`} className="px-1 pb-2 text-xs font-semibold text-text-muted">{section.title}</h2>
              <Card>
                <ul>
                  {groups[section.id].map(task => <TaskRow key={task.id} {...rowProps(task)} upcoming={section.id === 'upcoming'} />)}
                </ul>
              </Card>
            </section>
          ))}
          {groups.done.length > 0 && (
            <section aria-label="已完成" className="animate-reveal-up">
              <button
                type="button"
                aria-expanded={showDone}
                onClick={() => setShowDone(open => !open)}
                className="flex min-h-11 items-center gap-1 px-1 text-xs font-semibold text-text-muted transition-colors duration-300 ease-calm hover:text-text-secondary"
              >
                已完成 · {groups.done.length}
                <ChevronDown size={14} className={`transition-transform duration-300 ease-calm ${showDone ? 'rotate-180' : ''}`} />
              </button>
              {showDone && (
                <Card>
                  <ul>{groups.done.map(task => <TaskRow key={task.id} {...rowProps(task)} upcoming={false} />)}</ul>
                </Card>
              )}
            </section>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border-hairline bg-surface-card px-4 py-3">
        {adding
          ? <TaskForm onDone={() => setAdding(false)} />
          : (
            <div className="mx-auto max-w-3xl">
              <Button onClick={() => setAdding(true)} className="w-full"><Plus size={16} /> 新安排</Button>
            </div>
          )}
      </div>
    </div>
  )
}
