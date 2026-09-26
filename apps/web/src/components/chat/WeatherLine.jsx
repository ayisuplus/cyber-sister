import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { useWeatherStore } from '../../stores/weatherStore'
import { showsTomorrow, weatherLine, weatherTip } from '../../features/weather'
import { WeatherIcon } from './WeatherDoodles'

function DayRow({ label, day }) {
  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <WeatherIcon icon={day.icon} size={22} className="shrink-0 text-action-primary" />
      <span className="w-8 shrink-0 text-xs text-text-muted">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{day.condition}</span>
      <span className="shrink-0 text-sm tabular-nums text-text-primary">{day.min}–{day.max}°</span>
      {Number.isFinite(day.precipitation) && day.precipitation >= 10 && (
        <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-text-muted">降水 {day.precipitation}%</span>
      )}
    </li>
  )
}

const CARD_WIDTH = 288
const EDGE = 16

/** 卡片挂在那一行正下方，左右不出屏幕。 */
function placeUnder(trigger) {
  const rect = trigger?.getBoundingClientRect()
  const viewport = window.innerWidth
  const width = Math.min(CARD_WIDTH, viewport - EDGE * 2)
  const left = Math.max(EDGE, Math.min((rect?.left ?? EDGE) - 4, viewport - width - EDGE))
  return { top: (rect?.bottom ?? 0) + 8, left, width }
}

/**
 * 点开页头那一行看到的小卡片：今天、明天，最多一句惦记，末尾署名数据来源（Open-Meteo，CC BY 4.0）。
 * 挂到 body 上：页头和本子是同一层的兄弟，卡片留在页头里会被本子盖住。
 * 点外面或按 Esc 收起，焦点回到那一行。
 */
function WeatherCard({ weather, hour, onClose, triggerRef }) {
  const cardRef = useRef(/** @type {HTMLDivElement | null} */ (null))
  const titleId = useId()
  const [position, setPosition] = useState(() => placeUnder(triggerRef.current))
  const tip = weatherTip(weather, hour)
  const where = [weather.place.name, weather.place.admin1].filter(Boolean).join(' · ')

  useEffect(() => {
    const onResize = () => setPosition(placeUnder(triggerRef.current))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [triggerRef])

  useEffect(() => {
    cardRef.current?.focus()
    const onKey = (/** @type {KeyboardEvent} */ event) => {
      if (event.key === 'Escape') onClose()
    }
    const onPointer = (/** @type {PointerEvent} */ event) => {
      const target = /** @type {Node} */ (event.target)
      if (cardRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [onClose, triggerRef])

  return createPortal(
    <div
      ref={cardRef}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      style={{ position: 'fixed', top: position.top, left: position.left, width: position.width }}
      className="animate-reveal-up z-50 rounded-card bg-surface-card p-4 shadow-float ring-1 ring-border-hairline focus:outline-none"
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <h3 id={titleId} className="font-hand text-[15px] tracking-[0.04em] text-text-primary">{where}</h3>
        <button type="button" onClick={onClose} aria-label="收起天气" className="-mr-2 -mt-2 flex h-9 w-9 items-center justify-center rounded-full text-text-muted hover:bg-surface-muted">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <ul>
        <DayRow label="今天" day={weather.today} />
        <DayRow label="明天" day={weather.tomorrow} />
      </ul>
      {tip && <p className="mt-2 font-hand text-[14px] leading-relaxed text-text-secondary">{tip}</p>}
      <p className="mt-3 text-[10px] leading-relaxed text-text-muted">
        数据来自 Open-Meteo · <Link to="/settings" className="underline underline-offset-2 hover:text-text-secondary">在设置里换城市</Link>
      </p>
    </div>,
    document.body,
  )
}

const RECHECK_MS = 30 * 60 * 1000

/**
 * 页头名字下面的一行天气。没填城市、取不到或功能关着时什么都不渲染——不给假天气。
 * 白天写此刻，傍晚以后写明天。
 */
export default function WeatherLine() {
  const weather = useWeatherStore((state) => state.weather)
  const load = useWeatherStore((state) => state.load)
  const [open, setOpen] = useState(false)
  const [hour, setHour] = useState(() => new Date().getHours())
  const triggerRef = useRef(/** @type {HTMLButtonElement | null} */ (null))

  // 进聊天页拉一次；标签页回到前台、离上次超过半小时再拉（store 自己判断新鲜度）
  useEffect(() => {
    load()
    const onVisible = () => {
      if (document.hidden) return
      setHour(new Date().getHours())
      load()
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(() => setHour(new Date().getHours()), RECHECK_MS)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [load])

  const line = weatherLine(weather, hour)
  if (!line) return null

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={showsTomorrow(hour) ? '看看明天的天气' : '看看今天的天气'}
        className="-ml-1 flex max-w-[11rem] items-center gap-1 rounded-full px-1 py-0.5 font-hand text-[12px] leading-tight text-text-muted transition-colors duration-200 ease-calm hover:text-text-secondary min-[400px]:max-w-[14rem]"
      >
        <WeatherIcon icon={line.icon} size={13} className="shrink-0" />
        <span className="truncate">{line.text}</span>
      </button>
      {open && <WeatherCard weather={weather} hour={hour} onClose={close} triggerRef={triggerRef} />}
    </div>
  )
}
