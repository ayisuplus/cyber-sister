import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, subDays, eachDayOfInterval } from 'date-fns'
import { Droplets, MoonStar, Dumbbell, BookOpen, Flower2, PenLine, Check, Trash2, NotebookPen, Sparkles, Plus } from 'lucide-react'
import Header from '../components/layout/Header'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import SourceBadge from '../components/ui/SourceBadge'
import Spinner from '../components/ui/Spinner'
import { habitService } from '../services/habitService'

const HABIT_ICONS = [
  { value: 'droplet', label: '喝水', icon: Droplets },
  { value: 'moon', label: '早睡', icon: MoonStar },
  { value: 'dumbbell', label: '运动', icon: Dumbbell },
  { value: 'book', label: '阅读', icon: BookOpen },
  { value: 'flower', label: '养花', icon: Flower2 },
  { value: 'pen', label: '记录', icon: PenLine },
]
const iconOf = (value) => HABIT_ICONS.find(item => item.value === value)?.icon || PenLine

const MAX_HABITS = 12

export default function HandbookPage() {
  const [habits, setHabits] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  const [newName, setNewName] = useState('')
  const [newIcon, setNewIcon] = useState('droplet')
  const [adding, setAdding] = useState(false)
  const [formError, setFormError] = useState('')
  const [actionError, setActionError] = useState('')
  const [habitToArchive, setHabitToArchive] = useState(null)
  const [cheerLoading, setCheerLoading] = useState(false)
  const [cheerError, setCheerError] = useState('')
  const [cheerResult, setCheerResult] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true); setLoadError('')
    habitService.list()
      .then(list => { if (alive) setHabits(Array.isArray(list) ? list : []) })
      .catch(() => { if (alive) setLoadError('加载失败，请检查网络后重试') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [reloadTick])

  // 打卡/新建/归档后的静默刷新：不打扰整页三态
  const refresh = async () => {
    setHabits(await habitService.list())
  }

  const handleCheckin = async (habit) => {
    setActionError('')
    try {
      await habitService.checkin(habit.id)
      await refresh()
    } catch {
      setActionError('打卡失败，请稍后再试')
    }
  }

  const handleAdd = async () => {
    const name = newName.trim()
    if (!name || adding) return
    setAdding(true); setFormError('')
    try {
      await habitService.create({ name, icon: newIcon })
      setNewName('')
      setNewIcon('droplet')
      await refresh()
    } catch (requestError) {
      setFormError(requestError?.response?.data?.error || '添加失败，请稍后再试')
    } finally {
      setAdding(false)
    }
  }

  const handleArchive = async () => {
    const target = habitToArchive
    setHabitToArchive(null)
    if (!target) return
    setActionError('')
    try {
      await habitService.archive(target.id)
      await refresh()
    } catch {
      setActionError('归档失败，请稍后再试')
    }
  }

  const handleCheer = async () => {
    if (cheerLoading) return
    setCheerLoading(true); setCheerError(''); setCheerResult(null)
    try {
      setCheerResult(await habitService.cheer())
    } catch (requestError) {
      const code = requestError?.response?.data?.code
      setCheerError(code === 'LOCAL_LLM_NOT_CONFIGURED' ? 'not_configured' : 'unavailable')
    } finally {
      setCheerLoading(false)
    }
  }

  // 近 30 天点阵的日期序列（旧 → 新）
  const recentWindow = useMemo(() => {
    const today = new Date()
    return eachDayOfInterval({ start: subDays(today, 29), end: today }).map(day => format(day, 'yyyy-MM-dd'))
  }, [])

  const atLimit = habits.length >= MAX_HABITS

  return (
    <div className="flex-1 flex flex-col bg-transparent overflow-hidden">
      <Header title="手帐打卡" showBack />

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
            {/* 姐妹说两句 */}
            <Card className="p-4">
              <Button variant="primary" className="w-full" disabled={cheerLoading} onClick={handleCheer}>
                {cheerLoading ? <Spinner onDark /> : <Sparkles size={16} />}
                姐妹说两句
              </Button>
              {cheerResult?.cheer && (
                <div className="mt-3 rounded-2xl bg-pastel-mist p-3">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">{cheerResult.cheer}</p>
                  <div className="mt-2">
                    <SourceBadge source={cheerResult.source} />
                  </div>
                </div>
              )}
              {cheerResult && !cheerResult.cheer && (
                <p className="mt-3 text-center text-xs text-text-muted">先加一个习惯再让姐妹看看</p>
              )}
              {cheerError === 'not_configured' && (
                <p role="alert" className="mt-3 text-xs text-danger">
                  还没有配置本地模型，去<Link to="/profile/local-model" className="underline">「我的 → 本地模型」</Link>设置好再来吧
                </p>
              )}
              {cheerError === 'unavailable' && (
                <p role="alert" className="mt-3 text-xs text-danger">姐妹现在有点忙，稍后再试试吧</p>
              )}
            </Card>

            {actionError && <p role="alert" className="text-xs text-danger">{actionError}</p>}

            {/* 习惯列表 */}
            {habits.length === 0 ? (
              <Card>
                <EmptyState icon={NotebookPen} title="还没有习惯，先加一个吧" />
              </Card>
            ) : (
              <div className="space-y-3">
                {habits.map(habit => {
                  const Icon = iconOf(habit.icon)
                  const checkedSet = new Set(habit.recentDays || [])
                  return (
                    <Card key={habit.id} className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-pastel-apricot text-action-primary" aria-hidden="true">
                          <Icon size={20} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-text-primary">{habit.name}</p>
                          <p className="text-xs text-text-muted">连续 {habit.streak} 天</p>
                        </div>
                        <button
                          type="button"
                          aria-label={`归档 ${habit.name}`}
                          onClick={() => setHabitToArchive(habit)}
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-text-muted hover:text-danger"
                        >
                          <Trash2 size={18} />
                        </button>
                        <button
                          type="button"
                          aria-label={`打卡 ${habit.name}`}
                          aria-pressed={habit.checkedToday}
                          onClick={() => handleCheckin(habit)}
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
                            habit.checkedToday
                              ? 'bg-status-local text-text-inverse'
                              : 'border-2 border-border-default text-text-muted'
                          }`}
                        >
                          {habit.checkedToday ? <Check size={20} /> : null}
                        </button>
                      </div>
                      {/* 近 30 天点阵 */}
                      <div className="mt-3 flex flex-wrap gap-1" aria-label={`${habit.name} 近 30 天打卡`}>
                        {recentWindow.map(day => (
                          <span
                            key={day}
                            title={day}
                            className={`h-1.5 w-1.5 rounded-full ${checkedSet.has(day) ? 'bg-status-local' : 'bg-border-subtle'}`}
                          />
                        ))}
                      </div>
                    </Card>
                  )
                })}
              </div>
            )}

            {/* 新习惯 */}
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-text-primary">新习惯</h2>
              {atLimit ? (
                <p className="mt-2 text-xs text-text-muted">最多 {MAX_HABITS} 个习惯，先归档一个再来吧</p>
              ) : (
                <>
                  <input
                    aria-label="习惯名称"
                    value={newName}
                    maxLength={20}
                    onChange={event => setNewName(event.target.value)}
                    placeholder="想坚持什么？比如喝水、早睡"
                    className="mt-3 min-h-11 w-full rounded-control bg-surface-input px-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-status-info"
                  />
                  <div className="mt-3 flex justify-between" role="radiogroup" aria-label="习惯图标">
                    {HABIT_ICONS.map(item => {
                      const Icon = item.icon
                      const selected = newIcon === item.value
                      return (
                        <button
                          key={item.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={item.label}
                          onClick={() => setNewIcon(item.value)}
                          className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
                            selected ? 'bg-pastel-blush text-action-primary' : 'bg-surface-muted text-text-muted'
                          }`}
                        >
                          <Icon size={20} />
                        </button>
                      )
                    })}
                  </div>
                  {formError && <p role="alert" className="mt-2 text-xs text-danger">{formError}</p>}
                  <Button variant="primary" className="mt-3 w-full" disabled={!newName.trim() || adding} onClick={handleAdd}>
                    {adding ? <Spinner onDark /> : <Plus size={16} />}
                    添加
                  </Button>
                </>
              )}
            </Card>
          </>
        )}
      </div>

      <ConfirmDialog
        open={habitToArchive !== null}
        title="归档习惯"
        description="历史打卡会保留，但不再显示在列表里"
        confirmLabel="确认归档"
        danger
        onConfirm={handleArchive}
        onCancel={() => setHabitToArchive(null)}
      />
    </div>
  )
}
