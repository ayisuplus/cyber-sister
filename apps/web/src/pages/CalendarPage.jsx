import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, addMonths, eachDayOfInterval, endOfMonth, format, getDay, isSameDay, startOfMonth, subMonths } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CloudFog, CloudRain, Flame, Laugh, Leaf, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import Header from '../components/layout/Header'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import PeriodToneSwitch from '../components/period/PeriodToneSwitch'
import { useToolsStore } from '../stores/toolsStore'
import { toolsService } from '../services/toolsService'
import { diaryService } from '../services/diaryService'
import { readingService } from '../services/readingService'
import { DATED_FREQS, FREQ_OPTIONS, WEEKDAY_LABELS, daysLeft, daysLeftLabel, describeWhen, groupTasks, occursOn } from '../features/schedule'

const SECTIONS = [
  { id: 'today', title: '今天' },
  { id: 'upcoming', title: '接下来' },
  { id: 'repeating', title: '重复' },
  { id: 'paused', title: '已暂停' },
]

const INITIAL_FORM = { content: '', freq: 'once', date: '', time: '', monthDay: 1, weekdays: [], isTask: false, instruction: '' }

// 情绪词表与手记页同一套（NotesPage 的 moodOf 未导出，这里沿用同样的小字视觉）
const MOODS = [
  { value: 'happy', label: '开心', icon: Laugh },
  { value: 'neutral', label: '平静', icon: Leaf },
  { value: 'sad', label: '难过', icon: CloudRain },
  { value: 'angry', label: '生气', icon: Flame },
  { value: 'anxious', label: '焦虑', icon: CloudFog },
]
const moodOf = (value) => MOODS.find((mood) => mood.value === value)

const chip = (active) => `min-h-9 flex-1 rounded-full text-xs font-semibold transition-colors duration-300 ease-calm ${
  active ? 'bg-action-primary text-text-inverse' : 'bg-surface-muted text-text-secondary hover:bg-pastel-blush'
}`
const field = 'rounded-control border border-border-default bg-surface-input px-3 py-2 text-sm text-text-primary'
const iconButton = '-my-1.5 flex h-11 w-11 shrink-0 items-center justify-center text-text-muted transition-colors duration-300 ease-calm disabled:opacity-50'

function validate(form, now) {
  if (!form.content.trim()) return form.isTask ? '先给这件事起个名字吧' : '先写下要记的事吧'
  if (!form.time) return '选一个时间'
  if (DATED_FREQS.includes(form.freq) && !form.date) return form.freq === 'once' ? '一次的事要选日期' : '每年的事要选日期'
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

function TaskForm({ initial, onDone }) {
  const addTask = useToolsStore(s => s.addScheduledReminder)
  const [form, setForm] = useState({ ...INITIAL_FORM, ...initial })
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
    <form onSubmit={submit} aria-label="记一件事" className="mx-auto max-w-3xl animate-reveal-up space-y-3">
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
          aria-label={form.isTask ? '这件事叫什么' : '要记的事'}
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
        <Button type="submit" disabled={saving} className="flex-1">保存</Button>
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
      {!done && (
        <button type="button" disabled={busy} onClick={() => onChange(task, { status: 'done' })}
          aria-label={`${task.freq === 'once' ? '完成' : '结束重复'}：${task.content}`}
          title={task.freq === 'once' ? '完成这件事' : '结束整个重复系列，后续不再提醒'}
          className={`${iconButton} gap-1 px-2 hover:text-action-primary`}>
          {task.freq === 'once' ? <Check size={17} /> : <span className="whitespace-nowrap text-xs">结束重复</span>}
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

// 「日历」：安排（日程、倒数日、提醒、每天的小习惯）和经期合成一页。月历看整月，点某天看/加当天的事。
export default function CalendarPage() {
  const tasks = useToolsStore(s => s.scheduledReminders)
  const loadTasks = useToolsStore(s => s.loadScheduledReminders)
  const updateTask = useToolsStore(s => s.updateScheduledReminder)
  const removeTask = useToolsStore(s => s.removeScheduledReminder)
  const { periodRecords, addPeriodRecord, updatePeriodRecord, deletePeriodRecord } = useToolsStore()
  const loadPeriodRecords = useToolsStore(s => s.loadPeriodRecords)

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  const [mutating, setMutating] = useState(null)
  const [actionError, setActionError] = useState('')
  const [adding, setAdding] = useState(false)
  const [formInitial, setFormInitial] = useState({ freq: 'once', date: '' })
  const [showDone, setShowDone] = useState(false)

  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selected, setSelected] = useState(() => new Date())
  const [summary, setSummary] = useState(null)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [saving, setSaving] = useState(false)
  const [consented, setConsented] = useState(null)

  // 「那天的记录」：选中的日子一变就并行取当天的手记和读书笔记。
  // 这天还没有日记（404）或请求失败都不占位、不报错，只是少一行。
  const dayKey = format(selected, 'yyyy-MM-dd')
  const [dayDiary, setDayDiary] = useState(null)
  const [dayNotes, setDayNotes] = useState([])
  useEffect(() => {
    let alive = true
    setDayDiary(null); setDayNotes([])
    Promise.all([
      diaryService.getDay(dayKey).catch(() => null),
      readingService.listNotesBetween({ from: dayKey, to: dayKey }).catch(() => []),
    ]).then(([diary, notes]) => {
      if (!alive) return
      setDayDiary(diary)
      setDayNotes(notes ?? [])
    })
    return () => { alive = false }
  }, [dayKey])

  useEffect(() => {
    let alive = true
    setLoading(true); setLoadError('')
    Promise.all([loadTasks(), toolsService.getPeriodConsent()])
      .then(([, consent]) => { if (alive) setConsented(consent?.accepted === true) })
      .catch(() => { if (alive) setLoadError('日历没加载出来，请重试') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [loadTasks, reloadTick])

  // 撤回后仍可查看和删除已有记录；推算和月历标注只在同意时启用。
  useEffect(() => {
    if (consented === null) return undefined
    let alive = true
    const summaryRequest = consented ? toolsService.getPeriodSummary(format(new Date(), 'yyyy-MM-dd')) : Promise.resolve(null)
    Promise.all([loadPeriodRecords(), summaryRequest])
      .then(([, result]) => { if (alive) setSummary(result) })
      .catch(() => { if (alive) setLoadError('日历没加载出来，请重试') })
    return () => { alive = false }
  }, [consented, loadPeriodRecords, reloadTick])

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

  const saveRecord = async (entry) => {
    if (saving) return
    setSaving(true); setActionError('')
    try {
      const payload = { startDate: entry.startDate, endDate: entry.endDate || null, cycleDays: Number(entry.cycleDays) }
      if (entry.id) await updatePeriodRecord(entry.id, payload)
      else await addPeriodRecord(payload.startDate, payload.endDate, payload.cycleDays)
      setEditing(null)
      setSummary(null)
      setReloadTick(tick => tick + 1)
    } catch (error) {
      setActionError(error?.response?.data?.error || '保存失败，记录内容已保留，请重试')
    } finally { setSaving(false) }
  }

  const decideConsent = async (accepted) => {
    if (saving) return
    setSaving(true); setActionError('')
    try {
      const result = await toolsService.setPeriodConsent(accepted)
      setConsented(result?.accepted === true)
      if (!accepted) { setEditing(null); setSummary(null) }
    } catch { setActionError('没有保存成功，请重试') }
    finally { setSaving(false) }
  }

  const removeRecord = async () => {
    if (!deleting || saving) return
    setSaving(true); setActionError('')
    try {
      await deletePeriodRecord(deleting.id)
      setDeleting(null)
      setSummary(null)
      setReloadTick(tick => tick + 1)
    } catch { setActionError('删除失败，请重试') }
    finally { setSaving(false) }
  }

  const now = new Date()
  const groups = groupTasks(tasks, now)
  const rowProps = (task) => ({ task, now, busy: mutating !== null, onChange: mutate, onDelete: (target) => mutate(target) })

  // 月历：record.startDay/endDay 已在 store 加载边界归一化为本地日历日
  const days = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) })
  const startDay = getDay(startOfMonth(currentMonth)) // 0=周日
  const nextDate = consented && summary?.nextDate ? new Date(`${summary.nextDate}T00:00:00`) : null
  const periodRecordOn = (date) => {
    for (const record of periodRecords) {
      if (!record.startDay) continue
      const end = record.endDay ?? addDays(record.startDay, 5)
      if (date >= record.startDay && date <= end) return record
    }
    return null
  }

  const daysUntil = summary?.daysUntil
  // 过了预计的日子还没记：不再钉在「还有 0 天」，如实写晚了几天
  const overdueDays = summary?.overdueDays > 0 ? summary.overdueDays : 0

  const dayTasks = tasks.filter(task => occursOn(task, selected))
  const selectedRecord = consented ? periodRecordOn(selected) : null
  const diaryMood = moodOf(dayDiary?.mood)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header title="日历" showBack />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-4 py-4">
          {loadError && (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-danger">{loadError}</p>
              <Button variant="secondary" onClick={() => setReloadTick(tick => tick + 1)}>重新加载</Button>
            </div>
          )}
          {actionError && !deleting && <p role="alert" className="text-sm text-danger">{actionError}</p>}

          {/* 月历：安排的小点和经期的底色画在同一张月历上 */}
          <Card className="p-4" role="group" aria-label="月历">
            <div className="mb-4 flex items-center justify-between">
              <button type="button" aria-label="上个月" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className={iconButton}>
                <ChevronLeft size={20} className="text-text-secondary" />
              </button>
              <h2 className="text-sm font-semibold text-text-primary">
                {format(currentMonth, 'yyyy年M月', { locale: zhCN })}
              </h2>
              <button type="button" aria-label="下个月" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className={iconButton}>
                <ChevronRight size={20} className="text-text-secondary" />
              </button>
            </div>
            <div className="mb-2 grid grid-cols-7 gap-1">
              {['日', '一', '二', '三', '四', '五', '六'].map(d => (
                <div key={d} className={`text-center text-xs ${d === '六' || d === '日' ? 'text-brand-pink' : 'text-text-muted'}`}>
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: startDay }).map((_, i) => (
                <div key={`empty-${i}`} />
              ))}
              {days.map(day => {
                const isToday = isSameDay(day, new Date())
                const record = consented ? periodRecordOn(day) : null
                const isPredicted = !record && nextDate ? isSameDay(day, nextDate) : false
                const count = tasks.filter(task => occursOn(task, day)).length
                const mark = record ? '经期中' : isPredicted ? '预计来的日子' : ''
                const label = [format(day, 'M月d日', { locale: zhCN }), mark, count > 0 ? `有 ${count} 件事` : ''].filter(Boolean).join('，')
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    aria-label={label}
                    onClick={() => setSelected(day)}
                    className={`flex aspect-square flex-col items-center justify-center rounded-full text-sm ${
                      isToday
                        ? 'bg-gradient-pink-purple text-text-inverse font-bold'
                        : record
                          ? 'bg-pastel-blush text-brand-pink'
                          : isPredicted
                            ? 'border border-dashed border-brand-pink text-brand-pink'
                            : 'text-text-primary'
                    } ${isSameDay(day, selected) ? 'ring-2 ring-action-primary' : ''}`}
                  >
                    {format(day, 'd')}
                    {count > 0 && <span className="mx-auto mt-0.5 h-1 w-1 rounded-full bg-action-primary" />}
                  </button>
                )
              })}
            </div>
          </Card>

          {/* 这一天：当天的事 + 当天的经期 */}
          <Card className="animate-reveal-up p-4" role="group" aria-label="这一天">
            <h2 className="text-sm font-semibold text-text-primary">{format(selected, 'M月d日 EEEE', { locale: zhCN })}</h2>
            {dayTasks.length > 0 ? (
              <ul className="-mx-4 mt-3">
                {dayTasks.map(task => <TaskRow key={task.id} {...rowProps(task)} upcoming={false} />)}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-text-muted">这天还没有事</p>
            )}
            {consented && (selectedRecord ? (
              <div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-3">
                <div>
                  <p className="text-sm text-text-primary">这天在经期里</p>
                  <p className="text-xs text-text-muted">周期 {selectedRecord.cycleDays} 天</p>
                </div>
                <div className="flex gap-1">
                  <button type="button" disabled={saving} aria-label={`编辑 ${selectedRecord.startDate.slice(0, 10)} 的记录`} onClick={() => { setActionError(''); setEditing({ id: selectedRecord.id, startDate: selectedRecord.startDate.slice(0, 10), endDate: selectedRecord.endDate?.slice(0, 10) || '', cycleDays: selectedRecord.cycleDays }) }} className="flex h-11 w-11 shrink-0 items-center justify-center text-text-secondary"><Pencil size={16} /></button>
                  <button type="button" disabled={saving} aria-label={`删除 ${selectedRecord.startDate.slice(0, 10)} 的记录`} onClick={() => { setActionError(''); setDeleting(selectedRecord) }} className="flex h-11 w-11 shrink-0 items-center justify-center text-text-secondary"><Trash2 size={16} /></button>
                </div>
              </div>
            ) : (
              <Button variant="secondary" className="mt-3 w-full" disabled={saving} onClick={() => { setActionError(''); setEditing({ startDate: format(selected, 'yyyy-MM-dd'), endDate: '', cycleDays: 28 }) }}>在这天记经期</Button>
            ))}
            <Button className="mt-4 w-full" onClick={() => { setFormInitial({ freq: 'once', date: format(selected, 'yyyy-MM-dd') }); setAdding(true) }}><Plus size={16} /> 记一件事</Button>
          </Card>

          {/* 那天的记录：当天的手记、读书笔记、经期合成一格；全空就整块不出现 */}
          {(dayDiary || dayNotes.length > 0 || (consented && selectedRecord)) && (
            <Card className="animate-reveal-up p-4" role="group" aria-label="那天的记录">
              <h2 className="text-sm font-semibold text-text-primary">那天的记录</h2>
              {dayDiary && (
                <article className="mt-3 first:mt-2">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">{dayDiary.content}</p>
                  {diaryMood && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
                      <span className="flex items-center gap-1">{(() => { const Icon = diaryMood.icon; return <Icon size={13} aria-hidden="true" /> })()}{diaryMood.label}</span>
                    </div>
                  )}
                </article>
              )}
              {dayNotes.map(note => (
                <article key={note.id} className="mt-3 border-t border-border-subtle pt-3">
                  <p className="text-xs text-text-muted">《{note.book || '未命名'}》{note.page != null && ` · 第 ${note.page} 页`}</p>
                  {note.quote && (
                    <blockquote className="mt-2 line-clamp-2 border-l-2 border-border-subtle pl-3 text-xs leading-relaxed text-text-muted">{note.quote}</blockquote>
                  )}
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-text-primary">{note.content}</p>
                  {note.bookId && note.locator && (
                    <Link to={`/tools/reading/${note.bookId}?at=${encodeURIComponent(note.locator)}`} className="mt-2 flex min-h-11 items-center text-xs text-action-primary underline">
                      回到书里这一处
                    </Link>
                  )}
                </article>
              ))}
              {consented && selectedRecord && (
                <p className="mt-3 border-t border-border-subtle pt-3 text-sm text-text-primary">经期中</p>
              )}
            </Card>
          )}

          {/* 经期的修正/补记表单 */}
          {consented && editing && (
            <Card className="space-y-3 p-4">
              <h3 className="text-sm font-semibold text-text-primary">{editing.id ? '修正记录' : '补记记录'}</h3>
              {[
                { key: 'startDate', label: '开始日期', type: 'date' },
                { key: 'endDate', label: '结束日期（可空）', type: 'date' },
                { key: 'cycleDays', label: '周期天数', type: 'number' },
              ].map(item => (
                <label key={item.key} className="block text-xs text-text-secondary">
                  {item.label}
                  <input type={item.type} value={editing[item.key]} min={item.key === 'cycleDays' ? 20 : undefined} max={item.key === 'cycleDays' ? 45 : undefined} onChange={event => setEditing(previous => ({ ...previous, [item.key]: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-border-default bg-surface-input px-3 text-sm text-text-primary" />
                </label>
              ))}
              <div className="flex gap-2">
                <Button disabled={saving || !editing.startDate} onClick={() => saveRecord(editing)}>保存记录</Button>
                <Button variant="secondary" disabled={saving} onClick={() => setEditing(null)}>取消</Button>
              </div>
            </Card>
          )}

          {/* 经期倒计时 */}
          {consented && (
            <div className="period-summary bg-gradient-pink-purple rounded-card p-6 text-center text-text-inverse">
              <p className="text-sm mb-2">{overdueDays ? '比预计晚了' : '距离下次大姨妈还有'}</p>
              <p className="text-6xl font-mono font-bold">{overdueDays || (daysUntil ?? '--')}</p>
              <p className="text-sm mt-1">天</p>
              {nextDate && (
                <p className="text-xs mt-2">预计 {format(nextDate, 'M月d日')}</p>
              )}
              <p className="mt-2 text-xs">{overdueDays ? '晚几天很常见；来了记一笔，推算会更准' : '按已记录周期推算，仅供日程参考'}</p>
            </div>
          )}

          {/* 同意卡：经期是敏感个人信息，记录之前先说清楚 */}
          {!loading && !loadError && !consented && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-text-primary">记录经期之前</h2>
              <p className="mt-2 text-xs leading-relaxed text-text-secondary">
                经期属于敏感的个人健康信息。同意后，你记下的日子会保存在 Amie 的服务器上，只用来推算下一次、到时候提醒你，以及在你问起时让她知道。你随时可以撤回同意，也可以删除任何一条记录。
              </p>
              <Button className="mt-4 w-full" disabled={saving} onClick={() => decideConsent(true)}>同意并开始记录</Button>
              {periodRecords.length > 0 && (
                <div className="mt-4 border-t border-border-subtle pt-3">
                  <h3 className="text-xs font-semibold text-text-primary">已有记录</h3>
                  <ul className="mt-2 space-y-2">
                    {periodRecords.map(record => (
                      <li key={record.id} className="flex items-center justify-between gap-2 text-xs text-text-secondary">
                        <span>{record.startDate.slice(0, 10)} · 周期 {record.cycleDays} 天</span>
                        <button type="button" disabled={saving} aria-label={`删除 ${record.startDate.slice(0, 10)} 的记录`} onClick={() => { setActionError(''); setDeleting(record) }} className="min-h-11 shrink-0 px-2 text-danger">删除</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}

          {!loading && !loadError && tasks.length === 0 && periodRecords.length === 0 && (
            <EmptyState
              icon={CalendarDays}
              title="日历还是空的"
              description="日程、倒数日、每天的小习惯，还有经期，都记在这一页。到点我会轻轻提醒你。也可以在对话里直接说「明天九点提醒我复诊」。"
            />
          )}
          {SECTIONS.map(section => groups[section.id].length > 0 && (
            <section key={section.id} aria-labelledby={`calendar-${section.id}`} className="animate-reveal-up">
              <h2 id={`calendar-${section.id}`} className="px-1 pb-2 text-xs font-semibold text-text-muted">{section.title}</h2>
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

          {consented && <>
            <PeriodToneSwitch />
            <p className="pt-2 text-center text-xs text-text-muted">
              撤回后不能再新增记录，她也不会再读取；已有记录仍在，可以删除。
              <button type="button" disabled={saving} onClick={() => decideConsent(false)} className="ml-1 min-h-11 underline">撤回同意</button>
            </p>
          </>}
        </div>
      </div>

      <div className="shrink-0 border-t border-border-hairline bg-surface-card px-4 py-3">
        {adding
          ? <TaskForm initial={formInitial} onDone={() => setAdding(false)} />
          : (
            <div className="mx-auto max-w-3xl">
              <Button onClick={() => { setFormInitial({ freq: 'once', date: '' }); setAdding(true) }} className="w-full"><Plus size={16} /> 记一件事</Button>
            </div>
          )}
      </div>

      <ConfirmDialog open={deleting !== null} title="删除经期记录" description="删除后无法恢复，确定删除这条记录吗？" confirmLabel="删除记录" error={actionError} busy={saving} danger onConfirm={removeRecord} onCancel={() => setDeleting(null)} />
    </div>
  )
}
