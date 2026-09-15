import { useEffect, useState } from 'react'
import { useToolsStore } from '../stores/toolsStore'
import { toolsService } from '../services/toolsService'
import Header from '../components/layout/Header'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { format, addDays, differenceInCalendarDays, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, getDay, subMonths, addMonths } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { CalendarHeart, ChevronLeft, ChevronRight, Plus, Pencil, Trash2 } from 'lucide-react'

export default function PeriodPage() {
  const { periodRecords, addPeriodRecord, updatePeriodRecord, deletePeriodRecord } = useToolsStore()
  const loadPeriodRecords = useToolsStore(s => s.loadPeriodRecords)
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  const [summary, setSummary] = useState(null)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true); setLoadError('')
    Promise.all([loadPeriodRecords(), toolsService.getPeriodSummary(format(new Date(), 'yyyy-MM-dd'))])
      .then(([, result]) => { if (alive) setSummary(result) })
      .catch(() => { if (alive) setLoadError('加载失败，请检查网络后重试') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [loadPeriodRecords, reloadTick])

  const daysUntil = summary?.daysUntil
  const nextDate = summary?.nextDate ? new Date(`${summary.nextDate}T00:00:00`) : null

  // 计算日历数据
  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
  const startDay = getDay(monthStart) // 0=周日

  // 标记周期日（粉色背景）：record.startDay/endDay 已在 store 加载边界归一化为本地日历日
  const isPeriodDay = (date) => {
    for (const record of periodRecords) {
      if (!record.startDay) continue
      const end = record.endDay ?? addDays(record.startDay, 5)
      if (date >= record.startDay && date <= end) return true
    }
    return false
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

  return (
    <div className="flex-1 flex flex-col bg-transparent overflow-hidden">
      <Header title="经期" showBack />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {actionError && !deleting && <p role="alert" className="text-sm text-danger">{actionError}</p>}
        {loading ? (
          <p role="status" className="py-8 text-center text-sm text-text-muted">加载中…</p>
        ) : loadError ? (
          <div className="py-8 text-center">
            <p role="alert" className="text-sm text-danger">{loadError}</p>
            <Button variant="secondary" className="mt-3" onClick={() => setReloadTick(tick => tick + 1)}>重试</Button>
          </div>
        ) : (
          <>
            {/* Hero卡片 */}
            <div className="period-summary bg-gradient-pink-purple rounded-card p-6 text-center text-text-inverse">
              <p className="text-sm mb-2">距离下次大姨妈还有</p>
              <p className="text-6xl font-mono font-bold">{daysUntil ?? '--'}</p>
              <p className="text-sm mt-1">天</p>
              {nextDate && (
                <p className="text-xs mt-2">预计 {format(nextDate, 'M月d日')}</p>
              )}
              <p className="mt-2 text-xs">按已记录周期推算，仅供日程参考</p>
            </div>

            {editing && (
              <Card className="space-y-3 p-4">
                <h3 className="text-sm font-semibold text-text-primary">{editing.id ? '修正记录' : '补记记录'}</h3>
                {[
                  { key: 'startDate', label: '开始日期', type: 'date' },
                  { key: 'endDate', label: '结束日期（可空）', type: 'date' },
                  { key: 'cycleDays', label: '周期天数', type: 'number' },
                ].map(field => (
                  <label key={field.key} className="block text-xs text-text-secondary">
                    {field.label}
                    <input type={field.type} value={editing[field.key]} min={field.key === 'cycleDays' ? 20 : undefined} max={field.key === 'cycleDays' ? 45 : undefined} onChange={event => setEditing(previous => ({ ...previous, [field.key]: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-border-default bg-surface-input px-3 text-sm text-text-primary" />
                  </label>
                ))}
                <div className="flex gap-2">
                  <Button disabled={saving || !editing.startDate} onClick={() => saveRecord(editing)}>保存记录</Button>
                  <Button variant="secondary" disabled={saving} onClick={() => setEditing(null)}>取消</Button>
                </div>
              </Card>
            )}

            {/* 日历 */}
            <Card className="p-4">
              {/* 月份导航 */}
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

              {/* 星期标题 */}
              <div className="grid grid-cols-7 gap-1 mb-2">
                {['日', '一', '二', '三', '四', '五', '六'].map(d => (
                  <div key={d} className={`text-center text-xs ${d === '六' || d === '日' ? 'text-brand-pink' : 'text-text-muted'}`}>
                    {d}
                  </div>
                ))}
              </div>

              {/* 日期网格 */}
              <div className="grid grid-cols-7 gap-1">
                {/* 空白占位 */}
                {Array.from({ length: startDay }).map((_, i) => (
                  <div key={`empty-${i}`} />
                ))}
                {days.map(day => {
                  const isToday = isSameDay(day, new Date())
                  const isPeriod = isPeriodDay(day)
                  return (
                    <div
                      key={day.toISOString()}
                      className={`aspect-square flex items-center justify-center rounded-full text-sm ${
                        isToday
                          ? 'bg-gradient-pink-purple text-text-inverse font-bold'
                          : isPeriod
                            ? 'bg-brand-pink/20 text-brand-pink'
                            : 'text-text-primary'
                      }`}
                    >
                      {format(day, 'd')}
                    </div>
                  )
                })}
              </div>
            </Card>

            {/* 记录列表 */}
            <Card className="p-4">
              <h3 className="text-sm font-semibold text-text-primary mb-3">最近记录</h3>
              {periodRecords.length === 0 ? (
                <EmptyState icon={CalendarHeart} title="暂无记录" />
              ) : (
                <div className="space-y-2">
                  {periodRecords.map(record => (
                    <div key={record.id} className="flex items-center justify-between py-2 border-b border-border-subtle last:border-0">
                      <div>
                        <p className="text-sm text-text-primary">{record.startDate.slice(0, 10)}</p>
                        <p className="text-xs text-text-muted">周期 {record.cycleDays} 天</p>
                      </div>
                      <span className="text-xs text-brand-pink bg-brand-pink/10 px-2 py-0.5 rounded-full">
                        {record.endDate ? `${differenceInCalendarDays(record.endDay, record.startDay) + 1}天` : '进行中'}
                      </span>
                      <button type="button" disabled={saving} aria-label={`编辑 ${record.startDate.slice(0, 10)} 的记录`} onClick={() => { setActionError(''); setEditing({ id: record.id, startDate: record.startDate.slice(0, 10), endDate: record.endDate?.slice(0, 10) || '', cycleDays: record.cycleDays }) }} className="flex h-11 w-11 shrink-0 items-center justify-center text-text-secondary"><Pencil size={16} /></button>
                      <button type="button" disabled={saving} aria-label={`删除 ${record.startDate.slice(0, 10)} 的记录`} onClick={() => { setActionError(''); setDeleting(record) }} className="flex h-11 w-11 shrink-0 items-center justify-center text-text-secondary"><Trash2 size={16} /></button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* 记录按钮 */}
            <Button variant="primary" className="w-full" disabled={saving} onClick={() => saveRecord({ startDate: format(new Date(), 'yyyy-MM-dd'), endDate: null, cycleDays: 28 })}>
              <Plus size={18} />
              记录今天
            </Button>
            <Button variant="secondary" className="w-full" disabled={saving} onClick={() => { setActionError(''); setEditing({ startDate: format(new Date(), 'yyyy-MM-dd'), endDate: '', cycleDays: 28 }) }}>补记记录</Button>
          </>
        )}
      </div>
      <ConfirmDialog open={deleting !== null} title="删除经期记录" description="删除后无法恢复，确定删除这条记录吗？" confirmLabel="删除记录" error={actionError} busy={saving} danger onConfirm={removeRecord} onCancel={() => setDeleting(null)} />
    </div>
  )
}
