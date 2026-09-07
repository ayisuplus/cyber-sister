import { useEffect, useMemo, useState } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useToolsStore } from '../stores/toolsStore'
import Header from '../components/layout/Header'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import { Plus, Check, Trash2, Clock, ListTodo } from 'lucide-react'

// 后端把 'yyyy-MM-dd' 存为 UTC 零点；parseISO 后按本地日历日格式化（北京时间为当天 08:00，不串日）
const toDayKey = (todo) => (todo.dueDate ? format(parseISO(todo.dueDate), 'yyyy-MM-dd') : null)

// 组内排序：有时间优先且按时间升序，无时间按创建先后
const byTimeThenCreated = (a, b) =>
  (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99')
  || (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

// 日程时间线分组：已过期 → 今天 → 明天 → 之后逐日 → 无日期 → 已完成
function buildScheduleGroups(todos, now = new Date()) {
  const todayKey = format(now, 'yyyy-MM-dd')
  const tomorrowKey = format(addDays(now, 1), 'yyyy-MM-dd')
  const groups = { overdue: [], today: [], tomorrow: [], later: new Map(), undated: [], done: [] }
  for (const todo of todos) {
    if (todo.isDone) { groups.done.push(todo); continue }
    const key = toDayKey(todo)
    if (!key) groups.undated.push(todo)
    else if (key < todayKey) groups.overdue.push(todo)
    else if (key === todayKey) groups.today.push(todo)
    else if (key === tomorrowKey) groups.tomorrow.push(todo)
    else {
      if (!groups.later.has(key)) groups.later.set(key, [])
      groups.later.get(key).push(todo)
    }
  }
  groups.overdue.sort(byTimeThenCreated)
  groups.today.sort(byTimeThenCreated)
  groups.tomorrow.sort(byTimeThenCreated)
  groups.undated.sort(byTimeThenCreated)
  groups.later = new Map([...groups.later.entries()].sort(([a], [b]) => a.localeCompare(b)))
  for (const list of groups.later.values()) list.sort(byTimeThenCreated)
  return groups
}

function dayLabel(key) {
  return format(parseISO(key), 'M月d日 EEEE', { locale: zhCN })
}

function ScheduleItem({ todo, showDate }) {
  const { toggleTodo, deleteTodo } = useToolsStore()
  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-b border-border-subtle last:border-0 ${todo.isDone ? 'opacity-60' : ''}`}>
      <button
        onClick={() => toggleTodo(todo.id)}
        aria-label={todo.isDone ? `标记未完成：${todo.content}` : `标记完成：${todo.content}`}
        className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors ${
          todo.isDone ? 'bg-brand-green' : 'border-2 border-brand-pink hover:bg-brand-pink/10'
        }`}
      >
        {todo.isDone && <Check size={12} className="text-text-inverse" />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${todo.isDone ? 'text-text-muted line-through' : 'text-text-primary'}`}>{todo.content}</p>
        {(showDate && todo.dueDate) || todo.dueTime ? (
          <span className="text-xs text-text-muted flex items-center gap-1 mt-0.5">
            <Clock size={10} />
            {showDate && todo.dueDate ? dayLabel(toDayKey(todo)) : ''}
            {todo.dueTime || ''}
          </span>
        ) : null}
      </div>
      <button
        onClick={() => deleteTodo(todo.id)}
        aria-label={`删除：${todo.content}`}
        className="text-text-muted hover:text-danger transition-colors"
      >
        <Trash2 size={16} />
      </button>
    </div>
  )
}

function ScheduleGroup({ title, items, tone = 'text-text-primary', showDate = false }) {
  if (items.length === 0) return null
  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-border-subtle">
        <h3 className={`text-sm font-semibold ${tone}`}>{title} ({items.length})</h3>
      </div>
      {items.map(todo => <ScheduleItem key={todo.id} todo={todo} showDate={showDate} />)}
    </Card>
  )
}

export default function TodoPage() {
  const { todos, addTodo } = useToolsStore()
  const loadTodos = useToolsStore(s => s.loadTodos)
  const [newContent, setNewContent] = useState('')
  const [newDate, setNewDate] = useState('')
  const [newTime, setNewTime] = useState('')
  const [formError, setFormError] = useState('')
  const [showInput, setShowInput] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true); setLoadError('')
    loadTodos()
      .catch(() => { if (alive) setLoadError('加载失败，请检查网络后重试') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [loadTodos, reloadTick])

  const groups = useMemo(() => buildScheduleGroups(todos), [todos])
  const pendingCount = todos.length - groups.done.length

  const resetForm = () => {
    setNewContent('')
    setNewDate('')
    setNewTime('')
    setFormError('')
    setShowInput(false)
  }

  const handleAdd = () => {
    if (!newContent.trim()) return
    if (newTime && !newDate) {
      setFormError('先选日期，再选时间')
      return
    }
    addTodo(newContent.trim(), newDate || undefined, newTime || undefined)
      .then(resetForm)
      .catch(() => setFormError('保存失败，请重试'))
  }

  return (
    <div className="flex-1 flex flex-col bg-transparent overflow-hidden">
      <Header title="日程" showBack />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {loading ? (
          <p role="status" className="py-8 text-center text-sm text-text-muted">加载中…</p>
        ) : loadError ? (
          <div className="py-8 text-center">
            <p role="alert" className="text-sm text-danger">{loadError}</p>
            <Button variant="secondary" className="mt-3" onClick={() => setReloadTick(tick => tick + 1)}>重试</Button>
          </div>
        ) : (
          <>
            <ScheduleGroup title="已过期" items={groups.overdue} tone="text-danger" showDate />
            <ScheduleGroup title={`今天 · ${format(new Date(), 'M月d日')}`} items={groups.today} />
            <ScheduleGroup title={`明天 · ${format(addDays(new Date(), 1), 'M月d日')}`} items={groups.tomorrow} />
            {[...groups.later.entries()].map(([key, items]) => (
              <ScheduleGroup key={key} title={dayLabel(key)} items={items} />
            ))}
            <ScheduleGroup title="无日期" items={groups.undated} />
            <ScheduleGroup title="已完成" items={groups.done} tone="text-text-muted" />

            {todos.length === 0 && (
              <EmptyState icon={ListTodo} title="暂无日程" description="点击下方按钮添加，可以顺手带上日期和时间" />
            )}
          </>
        )}
      </div>

      {/* 添加日程 */}
      <div className="px-4 py-3 bg-surface-card shadow-input">
        {showInput ? (
          <div className="space-y-2">
            <input
              type="text"
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && handleAdd()}
              placeholder="要做点什么..."
              aria-label="日程内容"
              autoFocus
              className="w-full min-h-11 bg-surface-input rounded-xl px-4 text-sm outline-none focus:ring-2 focus:ring-brand-pink/30"
            />
            <div className="flex gap-2">
              <input
                type="date"
                value={newDate}
                onChange={e => setNewDate(e.target.value)}
                aria-label="日期（可选）"
                className="flex-1 min-h-11 bg-surface-input rounded-xl px-3 text-sm text-text-primary outline-none focus:ring-2 focus:ring-brand-pink/30"
              />
              <input
                type="time"
                value={newTime}
                onChange={e => setNewTime(e.target.value)}
                aria-label="时间（可选）"
                className="flex-1 min-h-11 bg-surface-input rounded-xl px-3 text-sm text-text-primary outline-none focus:ring-2 focus:ring-brand-pink/30"
              />
            </div>
            {formError && <p role="alert" className="text-xs text-danger">{formError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                className="flex-1 min-h-11 bg-brand-pink text-text-inverse text-sm rounded-xl"
              >
                添加
              </button>
              <button
                onClick={resetForm}
                className="min-h-11 px-3 text-text-muted text-sm"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowInput(true)}
            className="w-full min-h-11 bg-brand-pink/10 text-brand-pink text-sm font-medium rounded-xl flex items-center justify-center gap-1"
          >
            <Plus size={16} />
            添加日程{pendingCount > 0 ? `（待完成 ${pendingCount}）` : ''}
          </button>
        )}
      </div>
    </div>
  )
}
