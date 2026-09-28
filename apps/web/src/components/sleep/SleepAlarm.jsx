import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useSleepStore } from '../../stores/sleepStore'
import { installAudioUnlock, startChime } from '../../features/sleep/chime'
import { notifyWake } from '../../features/sleep/notify'
import { DayPartDoodle } from '../letter/Decor'
import WakeCard from './WakeCard'

// 本地每 15 秒对一次表：用短间隔而不是一个长定时器，页面在后台被放慢、电脑睡醒以后都还对得上
const TICK_MS = 15_000
const REFRESH_MS = 10 * 60_000
// 响铃只在到点后 10 分钟内：过了点才打开页面，就不响也不弹，对话里安静地留一张早安便签
export const RING_WINDOW_MS = 10 * 60_000
export const SNOOZE_MS = 5 * 60_000
export const MAX_SNOOZES = 2
const FALLBACK_LINE = '天亮了，慢慢醒。'

/**
 * 全局的闹钟（路线图 C28）：登录后挂在外壳上，哪一页都守着。
 * - 早安：页面开着、到点时响铃（八音盒，渐强）、弹系统通知、盖一张早安卡。取不到那句话也照样响。
 * - 晚安：不出声、不弹通知；在对话页就是对话里那张便签，在别的页面底部浮一张小便签。
 */
export default function SleepAlarm() {
  const wake = useSleepStore((state) => state.wake)
  const bedtime = useSleepStore((state) => state.bedtime)
  const due = useSleepStore((state) => state.due)
  const load = useSleepStore((state) => state.load)
  const dismiss = useSleepStore((state) => state.dismiss)
  const { pathname } = useLocation()

  const armedAt = useRef(Date.now())
  const handled = useRef(new Set())
  const stopChime = useRef(null)
  const notification = useRef(null)
  const snooze = useRef(null)
  const [ringing, setRinging] = useState(null)

  useEffect(() => installAudioUnlock(), [])

  const silence = useCallback(() => {
    stopChime.current?.()
    stopChime.current = null
    notification.current?.close?.()
    notification.current = null
  }, [])

  useEffect(() => silence, [silence])

  const ring = useCallback(async (note, snoozes = 0) => {
    silence()
    setRinging({ note, snoozes, silent: false })
    notification.current = notifyWake(note.line?.text ?? FALLBACK_LINE)
    const stop = await startChime()
    stopChime.current = stop
    if (!stop) setRinging((current) => (current ? { ...current, silent: true } : current))
  }, [silence])

  // 每次拉到的便签里有新到点的早安：守着的时候到点、还在 10 分钟内，才响
  useEffect(() => {
    const now = Date.now()
    for (const note of due) {
      if (note.kind !== 'wake' || !note.id || handled.current.has(note.id)) continue
      handled.current.add(note.id)
      const at = Date.parse(note.fireAt)
      if (at > armedAt.current && now - at < RING_WINDOW_MS) ring(note)
    }
  }, [due, ring])

  // 定期拉一次，页面回到前台也拉一次
  useEffect(() => {
    const refresh = () => { load().catch(() => {}) }
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  // 对表：本地看到时间到了才去拉（拉的时候服务端建便签、推进到下一次）；再躺五分钟也在这里接着响
  useEffect(() => {
    const tick = async () => {
      const now = Date.now()
      if (snooze.current && now >= snooze.current.until) {
        const { note, snoozes } = snooze.current
        snooze.current = null
        ring(note, snoozes)
        return
      }
      const passed = (setting, kind) => {
        const at = setting?.enabled && setting.nextFireAt ? Date.parse(setting.nextFireAt) : null
        return at !== null && at <= now && !handled.current.has(`${kind}@${at}`) ? at : null
      }
      const wakeAt = passed(wake, 'wake')
      const bedAt = passed(bedtime, 'bedtime')
      if (wakeAt === null && bedAt === null) return
      if (wakeAt !== null) handled.current.add(`wake@${wakeAt}`)
      if (bedAt !== null) handled.current.add(`bedtime@${bedAt}`)
      try {
        await load()
      } catch {
        // 取不到那句话，闹钟也得响
        if (wakeAt !== null && wakeAt > armedAt.current && now - wakeAt < RING_WINDOW_MS) {
          ring({ id: null, kind: 'wake', fireAt: new Date(wakeAt).toISOString(), line: null })
        }
      }
    }
    tick()
    const timer = setInterval(tick, TICK_MS)
    return () => clearInterval(timer)
  }, [wake, bedtime, load, ring])

  // 更新函数里不做副作用：收起和再躺都先从这一刻的 ringing 读
  const ringingRef = useRef(null)
  ringingRef.current = ringing

  const getUp = useCallback(() => {
    silence()
    snooze.current = null
    const id = ringingRef.current?.note?.id
    setRinging(null)
    if (id) dismiss(id)
  }, [silence, dismiss])

  const lieIn = useCallback(() => {
    silence()
    const ringingNow = ringingRef.current
    if (ringingNow) snooze.current = { note: ringingNow.note, snoozes: ringingNow.snoozes + 1, until: Date.now() + SNOOZE_MS }
    setRinging(null)
  }, [silence])

  const bedNote = pathname === '/chat' ? null : due.find((note) => note.kind === 'bedtime')

  return (
    <>
      {ringing && (
        <WakeCard
          note={ringing.note}
          silent={ringing.silent}
          canSnooze={ringing.snoozes < MAX_SNOOZES}
          onGetUp={getUp}
          onSnooze={lieIn}
        />
      )}
      {bedNote && !ringing && (
        <aside aria-label="晚安便签" className="bedtime-note fixed bottom-4 left-1/2 z-40 w-[min(92vw,360px)] -translate-x-1/2 rounded-md px-4 py-3">
          <p className="flex items-start gap-2 text-[15px] leading-relaxed">
            <DayPartDoodle phase="night" size={16} className="mt-1" />
            <span className="flex-1 whitespace-pre-line">{bedNote.line?.text ?? '夜深了，把今天轻轻合上。'}</span>
          </p>
          <div className="mt-1 flex justify-end">
            <button type="button" onClick={() => dismiss(bedNote.id)} className="min-h-11 px-2 text-xs font-semibold text-action-primary">知道了</button>
          </div>
        </aside>
      )}
    </>
  )
}
