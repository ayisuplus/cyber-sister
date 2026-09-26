import { useEffect, useState } from 'react'
import { companionService } from '../../services/companionService'
import { Squiggle } from '../chat/Doodles'
import JournalDoodle from './JournalDoodles'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 北京时间的「今天」：YYYY-MM-DD，和后端按北京时间分组同一口径 */
function beijingToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function dayLabel(date, today) {
  const day = new Date(`${date}T00:00:00Z`)
  const gap = Math.round((new Date(`${today}T00:00:00Z`).getTime() - day.getTime()) / 86400000)
  if (gap === 0) return '今天'
  if (gap === 1) return '昨天'
  return `${day.getUTCMonth() + 1}月${day.getUTCDate()}日 ${WEEKDAYS[day.getUTCDay()]}`
}

// 「她这几天」：她为你做过的事，一天几行，手写在「她」页上。只写有记录的事，按模板拼，不叫模型编。
export default function HerJournal() {
  const [journal, setJournal] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    companionService.journal()
      .then((value) => { if (alive) setJournal(value) })
      .catch(() => { if (alive) setError('她这几天的手账暂时读不到，稍后再来看看。') })
    return () => { alive = false }
  }, [])

  const today = beijingToday()
  const days = journal?.days ?? []

  return (
    <section aria-labelledby="her-journal-title" className="rounded-card bg-surface-card p-4 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="her-journal-title" className="text-sm font-semibold text-text-primary">她这几天</h2>
        {journal && <span className="text-[11px] text-text-muted">最近 {journal.windowDays} 天</span>}
      </div>
      <Squiggle width={72} />
      <p className="mt-1 text-xs leading-relaxed text-text-secondary">她为你做过的事，只写真的发生过的。</p>

      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      {!error && !journal && <p className="mt-3 text-xs text-text-muted">正在翻开……</p>}
      {journal && days.length === 0 && (
        <p className="mt-3 font-hand text-sm leading-relaxed text-text-secondary">这几天还没有可以记下的事。和她聊聊，或者让她帮你记住一件事吧。</p>
      )}

      {days.length > 0 && (
        <ol className="mt-3 space-y-4">
          {days.map((day) => (
            <li key={day.date}>
              <h3 className="text-[11px] text-text-muted">{dayLabel(day.date, today)}</h3>
              <ul className="mt-1.5 space-y-1.5">
                {day.entries.map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className="flex gap-2.5">
                    <JournalDoodle kind={entry.kind} />
                    <p className="font-hand text-[15px] leading-relaxed text-text-primary">{entry.text}</p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}

      {journal && !journal.lettersOn && (
        <p className="mt-4 border-t border-border-subtle pt-3 text-[11px] leading-relaxed text-text-muted">
          写信关着的时候，她不会在你不在时回想，这里只记聊天时她做的事。想让她也想想你，在下面「她的来信」选个写信频率。
        </p>
      )}
    </section>
  )
}
