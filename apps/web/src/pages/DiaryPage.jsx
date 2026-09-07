import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, subMonths, addMonths } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { Laugh, Leaf, CloudRain, Flame, CloudFog, ChevronLeft, ChevronRight, Trash2, Sparkles } from 'lucide-react'
import Header from '../components/layout/Header'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import SourceBadge from '../components/ui/SourceBadge'
import Spinner from '../components/ui/Spinner'
import { diaryService } from '../services/diaryService'

const MOODS = [
  { value: 'happy', label: '开心', icon: Laugh, dot: 'bg-status-local' },
  { value: 'neutral', label: '平静', icon: Leaf, dot: 'bg-text-muted' },
  { value: 'sad', label: '难过', icon: CloudRain, dot: 'bg-status-info' },
  { value: 'angry', label: '生气', icon: Flame, dot: 'bg-danger' },
  { value: 'anxious', label: '焦虑', icon: CloudFog, dot: 'bg-status-warning' },
]
const moodOf = (value) => MOODS.find(m => m.value === value) || null
const todayString = () => format(new Date(), 'yyyy-MM-dd')

export default function DiaryPage() {
  const [currentMonth, setCurrentMonth] = useState(() => new Date())
  const [entries, setEntries] = useState({})
  const [selectedDay, setSelectedDay] = useState(todayString())
  const [content, setContent] = useState('')
  const [mood, setMood] = useState('neutral')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  const [saving, setSaving] = useState(false)
  const [savedTip, setSavedTip] = useState('')
  const [saveError, setSaveError] = useState('')
  const [commentLoading, setCommentLoading] = useState(false)
  const [commentError, setCommentError] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const entry = entries[selectedDay] || null

  // 编辑器填充只发生在：月加载落地（编辑器走单日接口，404 即「这一天还没有日记」）与点选日历
  const applyToEditor = useCallback((target) => {
    setContent(target?.content || '')
    setMood(target?.mood || 'neutral')
    setSavedTip('')
    setSaveError('')
    setCommentError('')
  }, [])
  const selectedDayRef = useRef(selectedDay)
  useEffect(() => { selectedDayRef.current = selectedDay }, [selectedDay])

  useEffect(() => {
    let alive = true
    setLoading(true); setLoadError('')
    const day = selectedDayRef.current
    const monthKey = format(currentMonth, 'yyyy-MM')
    Promise.all([
      diaryService.listMonth(monthKey),
      // 选中日在当前月才同步编辑器；不在则保持编辑器内容
      day.startsWith(monthKey)
        ? diaryService.getDay(day).catch(requestError => {
            if (requestError?.response?.status === 404) return null
            throw requestError
          })
        : Promise.resolve(undefined),
    ])
      .then(([list, fresh]) => {
        if (!alive) return
        const map = {}
        for (const item of Array.isArray(list) ? list : []) map[item.day] = item
        if (fresh) map[fresh.day || day] = fresh
        // 跨月切换不清掉已加载的日子：日历点选历史时始终能从 map 找回
        setEntries(prev => ({ ...prev, ...map }))
        if (fresh !== undefined) applyToEditor(fresh)
      })
      .catch(() => { if (alive) setLoadError('加载失败，请检查网络后重试') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [currentMonth, reloadTick, applyToEditor])

  // 日历只展示已加载月份，map 即权威数据，点选不再发请求
  const entriesRef = useRef(entries)
  useEffect(() => { entriesRef.current = entries }, [entries])
  const selectDay = (dayString) => {
    setSelectedDay(dayString)
    applyToEditor(entriesRef.current[dayString] || null)
  }

  const handleSave = async () => {
    const trimmed = content.trim()
    if (!trimmed || saving) return
    setSaving(true); setSaveError(''); setSavedTip('')
    try {
      const saved = await diaryService.saveDay(selectedDay, { content: trimmed, mood })
      setEntries(prev => ({
        ...prev,
        [selectedDay]: {
          ...(prev[selectedDay] || {}),
          ...(saved || {}),
          day: selectedDay,
          content: trimmed,
          mood,
          // 内容编辑会清空旧 AI 回应
          aiComment: saved?.aiComment ?? null,
          aiCommentSource: saved?.aiCommentSource ?? null,
        },
      }))
      setSavedTip('已保存')
    } catch {
      setSaveError('保存失败，请稍后再试')
    } finally {
      setSaving(false)
    }
  }

  const handleComment = async () => {
    if (!entry || commentLoading) return
    setCommentLoading(true); setCommentError('')
    try {
      const result = await diaryService.requestComment(selectedDay)
      setEntries(prev => ({
        ...prev,
        [selectedDay]: {
          ...prev[selectedDay],
          aiComment: result.aiComment,
          aiCommentSource: result.source,
        },
      }))
    } catch (requestError) {
      const code = requestError?.response?.data?.code
      setCommentError(code === 'CLOUD_NOT_CONSENTED' ? 'not_consented' : 'unavailable')
    } finally {
      setCommentLoading(false)
    }
  }

  const handleDelete = async () => {
    setShowDeleteConfirm(false)
    try {
      await diaryService.removeDay(selectedDay)
      setEntries(prev => {
        const next = { ...prev }
        delete next[selectedDay]
        return next
      })
      setContent('')
      setMood('neutral')
      setSavedTip('')
      setCommentError('')
    } catch {
      setSaveError('删除失败，请稍后再试')
    }
  }

  // 日历数据
  const monthStart = startOfMonth(currentMonth)
  const calendarDays = useMemo(
    () => eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) }),
    [currentMonth],
  )
  const startWeekday = getDay(monthStart)

  return (
    <div className="flex-1 flex flex-col bg-transparent overflow-hidden">
      <Header title="日记" showBack />

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
            {/* 编辑器 */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-text-primary">
                  {selectedDay === todayString() ? '今天' : format(new Date(`${selectedDay}T00:00:00`), 'M月d日')}的心情
                </h2>
                {entry && (
                  <button
                    type="button"
                    aria-label="删除这篇日记"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex h-11 w-11 items-center justify-center rounded-xl text-text-muted hover:text-danger"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>

              {/* 心情选择 */}
              <div className="flex justify-between" role="radiogroup" aria-label="心情">
                {MOODS.map(item => {
                  const Icon = item.icon
                  const selected = mood === item.value
                  return (
                    <button
                      key={item.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setMood(item.value)}
                      className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-1 rounded-2xl py-1 text-xs ${
                        selected ? 'bg-pastel-blush text-action-primary font-semibold' : 'text-text-muted'
                      }`}
                    >
                      <Icon size={20} />
                      {item.label}
                    </button>
                  )
                })}
              </div>

              <textarea
                aria-label="日记内容"
                value={content}
                maxLength={2000}
                onChange={event => { setContent(event.target.value); setSavedTip('') }}
                placeholder="今天发生了什么？写下来，姐妹都在听。"
                className="mt-3 h-32 w-full resize-none rounded-2xl bg-surface-input p-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-status-info"
              />
              <div className="mt-1 flex items-center justify-between text-xs text-text-muted">
                <span>{savedTip && <span className="text-status-local">{savedTip}</span>}</span>
                <span>{content.length}/2000</span>
              </div>
              {saveError && <p role="alert" className="mt-1 text-xs text-danger">{saveError}</p>}

              <Button variant="primary" className="mt-2 w-full" disabled={!content.trim() || saving} onClick={handleSave}>
                {saving ? <Spinner onDark /> : null}
                保存
              </Button>
            </Card>

            {/* AI 回应区 */}
            <Card className="p-4">
              <div className="flex items-center gap-2">
                <span className="inline-flex rounded-full bg-pastel-mist px-2 py-0.5 text-[10px] font-medium text-status-info">AI</span>
                <h2 className="text-sm font-semibold text-text-primary">姐妹的回应</h2>
              </div>
              {entry?.aiComment ? (
                <div className="mt-3">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">{entry.aiComment}</p>
                  <div className="mt-2">
                    <SourceBadge source={entry.aiCommentSource} />
                  </div>
                </div>
              ) : (
                <div className="mt-3">
                  <Button variant="secondary" className="w-full" disabled={!entry || commentLoading} onClick={handleComment}>
                    {commentLoading ? <Spinner /> : <Sparkles size={16} />}
                    让姐妹看看
                  </Button>
                  {!entry && (
                    <p className="mt-2 text-center text-xs text-text-muted">先保存今天的日记，姐妹才能看到哦</p>
                  )}
                  {commentError === 'not_consented' && (
                    <p role="alert" className="mt-2 text-xs text-danger">
                      还没有同意使用云端模型，去<Link to="/profile" className="underline">「我的 → 云端模型」</Link>开启后再让她看看吧
                    </p>
                  )}
                  {commentError === 'unavailable' && (
                    <p role="alert" className="mt-2 text-xs text-danger">姐妹现在有点忙，稍后再让她看看吧</p>
                  )}
                </div>
              )}
            </Card>

            {/* 月份日历 */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-4">
                <button type="button" aria-label="上个月" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                  <ChevronLeft size={20} className="text-text-secondary" />
                </button>
                <h3 className="text-sm font-semibold text-text-primary">
                  {format(currentMonth, 'yyyy年M月', { locale: zhCN })}
                </h3>
                <button type="button" aria-label="下个月" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                  <ChevronRight size={20} className="text-text-secondary" />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 mb-2">
                {['日', '一', '二', '三', '四', '五', '六'].map(d => (
                  <div key={d} className="text-center text-xs text-text-muted">{d}</div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: startWeekday }).map((_, i) => (
                  <div key={`empty-${i}`} />
                ))}
                {calendarDays.map(day => {
                  const dayString = format(day, 'yyyy-MM-dd')
                  const dayEntry = entries[dayString]
                  const moodConfig = moodOf(dayEntry?.mood)
                  const isToday = isSameDay(day, new Date())
                  const isSelected = dayString === selectedDay
                  return (
                    <button
                      key={dayString}
                      type="button"
                      aria-label={format(day, 'M月d日')}
                      aria-pressed={isSelected}
                      onClick={() => selectDay(dayString)}
                      className={`aspect-square flex flex-col items-center justify-center rounded-full text-sm ${
                        isSelected
                          ? 'bg-pastel-blush text-action-primary font-bold'
                          : isToday
                            ? 'ring-2 ring-action-primary text-text-primary font-semibold'
                            : 'text-text-primary'
                      }`}
                    >
                      {format(day, 'd')}
                      <span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${moodConfig ? moodConfig.dot : 'bg-transparent'}`} />
                    </button>
                  )
                })}
              </div>
            </Card>
          </>
        )}
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        title="删除这篇日记"
        description="删除后找不回来了，确定继续吗？"
        confirmLabel="确认删除"
        danger
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}
