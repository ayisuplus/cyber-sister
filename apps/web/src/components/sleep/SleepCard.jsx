import { useEffect, useState } from 'react'
import { ToggleLeft, ToggleRight } from 'lucide-react'
import Card from '../ui/Card'
import { DayPartDoodle } from '../letter/Decor'
import { useSleepStore } from '../../stores/sleepStore'
import { WEEKDAY_LABELS } from '../../features/schedule'
import { canPlaySound, previewChime } from '../../features/sleep/chime'
import { askNotificationPermission, notificationState } from '../../features/sleep/notify'

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
// 没设过时的样子：晚安每天 23:30，早安工作日 07:30，都先关着
const DEFAULTS = {
  bedtime: { enabled: false, time: '23:30', weekdays: EVERY_DAY },
  wake: { enabled: false, time: '07:30', weekdays: [1, 2, 3, 4, 5] },
}
// 周一在前、周日在后
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

const chip = (active) => `min-h-9 flex-1 rounded-full text-xs font-semibold transition-colors duration-300 ease-calm ${
  active ? 'bg-action-primary text-text-inverse' : 'bg-surface-muted text-text-secondary hover:bg-pastel-blush'
}`
const field = 'min-h-11 rounded-control border border-border-default bg-surface-input px-3 text-sm text-text-primary'

const settingOf = (kind, saved) => (saved
  ? { enabled: saved.enabled, time: saved.time ?? DEFAULTS[kind].time, weekdays: saved.weekdays?.length ? saved.weekdays : DEFAULTS[kind].weekdays }
  : DEFAULTS[kind])

const NOTIFY_TEXT = {
  granted: '系统通知已开：到点右下角会弹一条。',
  denied: '系统通知被浏览器关了，到点只有铃声。要开的话，在浏览器地址栏左边的网站设置里打开「通知」。',
  unsupported: '这个浏览器不支持系统通知，到点只有铃声。',
}

function SleepRow({ kind, title, phase, saved, busy, onSave, children }) {
  const [draft, setDraft] = useState(() => settingOf(kind, saved))
  useEffect(() => { setDraft(settingOf(kind, saved)) }, [kind, saved])

  const commit = (patch) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    onSave(kind, next).catch(() => setDraft(settingOf(kind, saved)))
  }
  const everyDay = draft.weekdays.length === 7
  const toggleDay = (day) => {
    const weekdays = draft.weekdays.includes(day) ? draft.weekdays.filter((item) => item !== day) : [...draft.weekdays, day]
    // 一天都不选等于关掉：留着原样，让她用开关来关
    if (weekdays.length === 0) return
    commit({ weekdays: weekdays.sort((a, b) => a - b) })
  }

  return (
    <section aria-label={title} className="border-b border-border-subtle px-4 py-3 last:border-0">
      <div className="flex items-center gap-2">
        <DayPartDoodle phase={phase} size={16} className="text-text-muted" />
        <h3 className="flex-1 text-sm font-semibold text-text-primary">{title}</h3>
        <input
          type="time"
          value={draft.time}
          disabled={busy}
          // 改钟点时每拨一格都会变：先记着，离开输入框或按回车再存
          onChange={(event) => { if (event.target.value) setDraft((current) => ({ ...current, time: event.target.value })) }}
          onBlur={() => { if (draft.time !== settingOf(kind, saved).time) commit({}) }}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
          aria-label={`${title}的时间`}
          className={field}
        />
        <button
          type="button"
          role="switch"
          aria-checked={draft.enabled}
          aria-label={title}
          disabled={busy}
          onClick={() => commit({ enabled: !draft.enabled })}
          className="flex h-11 w-11 shrink-0 items-center justify-center disabled:opacity-40"
        >
          {draft.enabled
            ? <ToggleRight size={24} className="text-brand-pink" aria-hidden="true" />
            : <ToggleLeft size={24} className="text-text-muted" aria-hidden="true" />}
        </button>
      </div>
      <div className="mt-2 flex gap-1" role="group" aria-label={`${title}在哪几天`}>
        <button type="button" disabled={busy} aria-pressed={everyDay} aria-label={`${title}：每天`} onClick={() => commit({ weekdays: EVERY_DAY })} className={`${chip(everyDay)} max-w-14`}>每天</button>
        {WEEK_ORDER.map((day) => (
          <button key={day} type="button" disabled={busy} aria-pressed={draft.weekdays.includes(day)} aria-label={`${title}：周${WEEKDAY_LABELS[day]}`} onClick={() => toggleDay(day)} className={chip(!everyDay && draft.weekdays.includes(day))}>
            {WEEKDAY_LABELS[day]}
          </button>
        ))}
      </div>
      {children}
    </section>
  )
}

/**
 * 睡眠卡（路线图 C28）：日程页最上面，晚安提醒与早安闹钟各一行。
 * 晚安不出声，只留一张便签；早安会响铃、弹系统通知——浏览器开着 Amie 才会响，这里如实写着。
 */
export default function SleepCard() {
  const bedtime = useSleepStore((state) => state.bedtime)
  const wake = useSleepStore((state) => state.wake)
  const loaded = useSleepStore((state) => state.loaded)
  const load = useSleepStore((state) => state.load)
  const save = useSleepStore((state) => state.save)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notify, setNotify] = useState(notificationState)
  const [previewing, setPreviewing] = useState(false)
  const [soundBlocked, setSoundBlocked] = useState(false)

  useEffect(() => {
    load().catch(() => setError('睡眠卡没加载出来，刷新再试试'))
  }, [load])

  const onSave = async (kind, setting) => {
    setBusy(true); setError('')
    try {
      // 打开早安闹钟的那一下顺便问系统通知（浏览器要求由点击触发）
      if (kind === 'wake' && setting.enabled && notificationState() === 'default') setNotify(await askNotificationPermission())
      await save(kind, setting)
    } catch (err) {
      setError(err?.response?.data?.error ?? '没保存上，再试一次')
      throw err
    } finally {
      setBusy(false)
    }
  }

  const preview = async () => {
    if (previewing) return
    setPreviewing(true)
    const stop = await previewChime()
    setSoundBlocked(!stop)
    setTimeout(() => setPreviewing(false), 5000)
  }

  const askNotify = async () => setNotify(await askNotificationPermission())

  return (
    <Card className="overflow-hidden" role="group" aria-label="睡眠">
      <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
        <DayPartDoodle phase="night" size={18} className="text-text-secondary" />
        <h2 className="text-sm font-semibold text-text-primary">睡眠</h2>
      </div>
      {!loaded ? (
        // 没取到就不摆「还没设过」的样子，免得她以为闹钟是关着的
        !error && <p className="px-4 py-3 text-xs text-text-muted">正在取睡眠卡…</p>
      ) : (
        <>
          <SleepRow kind="bedtime" title="晚安提醒" phase="night" saved={bedtime} busy={busy} onSave={onSave}>
            <p className="mt-2 text-xs leading-relaxed text-text-muted">到点不出声，只留一张晚安便签；那会儿你还在跟她聊的话，她会轻轻提一句。</p>
          </SleepRow>
          <SleepRow kind="wake" title="早安闹钟" phase="dawn" saved={wake} busy={busy} onSave={onSave}>
            <p className="mt-2 font-hand text-sm text-text-secondary">明早会有一句话等你。</p>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              浏览器里开着 Amie 才会响（切到别的标签页也行；电脑睡眠或关掉浏览器就不响，手机上也不响）。
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <button type="button" onClick={preview} disabled={previewing} className="min-h-11 text-xs font-semibold text-action-primary disabled:opacity-50">
                {previewing ? '正在试听…' : '试听铃声'}
              </button>
              {notify === 'default' && (
                <button type="button" onClick={askNotify} className="min-h-11 text-xs text-text-secondary underline">打开系统通知</button>
              )}
            </div>
            {NOTIFY_TEXT[notify] && <p className="text-xs leading-relaxed text-text-muted">{NOTIFY_TEXT[notify]}</p>}
            {(soundBlocked || (wake?.enabled && !canPlaySound())) && (
              <p className="mt-1 text-xs text-status-warning">这个页面现在出不了声：先在页面上随便点一下，铃声才能响。</p>
            )}
          </SleepRow>
        </>
      )}
      {error && <p role="alert" className="px-4 pb-3 text-xs text-danger">{error}</p>}
    </Card>
  )
}
