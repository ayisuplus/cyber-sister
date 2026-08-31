import { useEffect, useState } from 'react'
import { useToolsStore } from '../stores/toolsStore'
import Header from '../components/layout/Header'
import { format, addDays, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, getDay, subMonths, addMonths } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'

export default function PeriodPage() {
  const { periodRecords, addPeriodRecord, getDaysUntilPeriod, getNextPeriodDate } = useToolsStore()
  const loadPeriodRecords = useToolsStore(s => s.loadPeriodRecords)
  const [currentMonth, setCurrentMonth] = useState(new Date())
  useEffect(() => {
    loadPeriodRecords()
  }, [loadPeriodRecords])

  const daysUntil = getDaysUntilPeriod()
  const nextDate = getNextPeriodDate()

  // 计算日历数据
  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
  const startDay = getDay(monthStart) // 0=周日

  // 标记周期日（粉色背景）
  const isPeriodDay = (date) => {
    for (const record of periodRecords) {
      const start = new Date(record.startDate)
      const end = record.endDate ? new Date(record.endDate) : addDays(start, 5)
      if (date >= start && date <= end) return true
    }
    return false
  }

  const handleRecord = () => {
    const today = format(new Date(), 'yyyy-MM-dd')
    addPeriodRecord(today, null)
  }

  return (
    <div className="flex-1 flex flex-col bg-surface-page overflow-hidden">
      <Header title="大姨妈记录" showBack />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Hero卡片 */}
        <div className="bg-gradient-pink-purple rounded-[20px] p-6 text-center text-white">
          <p className="text-sm opacity-80 mb-2">距离下次大姨妈还有</p>
          <p className="text-6xl font-mono font-bold">{daysUntil ?? '--'}</p>
          <p className="text-sm opacity-80 mt-1">天</p>
          {nextDate && (
            <p className="text-xs opacity-60 mt-2">预计 {format(nextDate, 'M月d日')}</p>
          )}
        </div>

        {/* 日历 */}
        <div className="bg-white rounded-[20px] p-4 shadow-card">
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
                      ? 'bg-gradient-pink-purple text-white font-bold'
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
        </div>

        {/* 记录列表 */}
        <div className="bg-white rounded-[20px] p-4 shadow-card">
          <h3 className="text-sm font-semibold text-text-primary mb-3">最近记录</h3>
          {periodRecords.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-4">暂无记录</p>
          ) : (
            <div className="space-y-2">
              {periodRecords.slice(0, 3).map(record => (
                <div key={record.id} className="flex items-center justify-between py-2 border-b border-border-subtle last:border-0">
                  <div>
                    <p className="text-sm text-text-primary">{record.startDate}</p>
                    <p className="text-xs text-text-muted">周期 {record.cycleDays} 天</p>
                  </div>
                  <span className="text-xs text-brand-pink bg-brand-pink/10 px-2 py-0.5 rounded-full">
                    {record.endDate ? `${Math.ceil((new Date(record.endDate).getTime() - new Date(record.startDate).getTime()) / 86400000)}天` : '进行中'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 记录按钮 */}
        <button
          onClick={handleRecord}
          className="w-full h-12 bg-action-primary hover:bg-action-hover text-text-inverse font-semibold rounded-[23px] shadow-lg flex items-center justify-center gap-2"
        >
          <Plus size={18} />
          记录今天
        </button>
      </div>
    </div>
  )
}
