import { useEffect, useState } from 'react'
import { useToolsStore } from '../stores/toolsStore'
import Header from '../components/layout/Header'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import { format, addDays, differenceInCalendarDays, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, getDay, subMonths, addMonths } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { CalendarHeart, ChevronLeft, ChevronRight, Plus } from 'lucide-react'

export default function PeriodPage() {
  const { periodRecords, addPeriodRecord, getDaysUntilPeriod, getNextPeriodDate } = useToolsStore()
  const loadPeriodRecords = useToolsStore(s => s.loadPeriodRecords)
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true); setLoadError('')
    loadPeriodRecords()
      .catch(() => { if (alive) setLoadError('加载失败，请检查网络后重试') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [loadPeriodRecords, reloadTick])

  const daysUntil = getDaysUntilPeriod()
  const nextDate = getNextPeriodDate()

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

  const handleRecord = () => {
    const today = format(new Date(), 'yyyy-MM-dd')
    addPeriodRecord(today, null)
  }

  return (
    <div className="flex-1 flex flex-col bg-transparent overflow-hidden">
      <Header title="大姨妈记录" showBack />

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
            {/* Hero卡片 */}
            <div className="bg-gradient-pink-purple rounded-[20px] p-6 text-center text-text-inverse">
              <p className="text-sm opacity-80 mb-2">距离下次大姨妈还有</p>
              <p className="text-6xl font-mono font-bold">{daysUntil ?? '--'}</p>
              <p className="text-sm opacity-80 mt-1">天</p>
              {nextDate && (
                <p className="text-xs opacity-60 mt-2">预计 {format(nextDate, 'M月d日')}</p>
              )}
            </div>

            {/* 日历 */}
            <Card className="p-4">
              {/* 月份导航 */}
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                  <ChevronLeft size={20} className="text-text-secondary" />
                </button>
                <h3 className="text-sm font-semibold text-text-primary">
                  {format(currentMonth, 'yyyy年M月', { locale: zhCN })}
                </h3>
                <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
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
                  {periodRecords.slice(0, 3).map(record => (
                    <div key={record.id} className="flex items-center justify-between py-2 border-b border-border-subtle last:border-0">
                      <div>
                        <p className="text-sm text-text-primary">{record.startDate}</p>
                        <p className="text-xs text-text-muted">周期 {record.cycleDays} 天</p>
                      </div>
                      <span className="text-xs text-brand-pink bg-brand-pink/10 px-2 py-0.5 rounded-full">
                        {record.endDate ? `${differenceInCalendarDays(record.endDay, record.startDay)}天` : '进行中'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* 记录按钮 */}
            <Button variant="primary" className="w-full" onClick={handleRecord}>
              <Plus size={18} />
              记录今天
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
