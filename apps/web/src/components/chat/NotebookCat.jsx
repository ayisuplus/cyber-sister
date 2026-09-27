import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from '../../hooks/useReducedMotion'

// 本子角上的小猫（路线图 C17）：趴在本子右上角，每一页都在。
// 轻点它醒一下；来回摸它就呼噜；摸很久会伸个懒腰。不出声、不计数、不存任何东西、不发请求；
// 它不会饿，也不会因为你没来而难过。画是本机 ComfyUI 离线画好的四帧（来源见 design-assets/cat/cat-assets.json）。

const FRAMES = ['sleep', 'peek', 'purr', 'stretch']
const frameSrc = (frame) => `/design-assets/cat/cat-${frame}.webp`

const STROKE_PX = 48          // 按住来回摸，累计移动这么远就算在摸
const LONG_STROKE_MS = 2500   // 一直摸这么久，伸个懒腰
const TAP_BURST = 3           // 连点这么多下也算在摸
const TAP_WINDOW_MS = 1500
const PEEK_MS = 1200
const SETTLE_MS = 1500
const STRETCH_MS = 1500
const VIBRATE_EVERY_MS = 1200
const PURR_PATTERN = [12, 40, 12, 40, 12]

const ANNOUNCE = { peek: '小猫醒了一下', purr: '小猫在呼噜', stretch: '小猫伸了个懒腰' }

export const isNight = (hour) => hour >= 22 || hour < 5

function purrBuzz() {
  try {
    navigator.vibrate?.(PURR_PATTERN)
  } catch {
    // 不支持震动的设备（比如 iPhone 的 Safari）就只有画面
  }
}

export default function NotebookCat() {
  const reducedMotion = useReducedMotion()
  const [frame, setFrame] = useState('sleep')
  const [purrKey, setPurrKey] = useState(0)
  const [broken, setBroken] = useState(false)
  const [night, setNight] = useState(() => isNight(new Date().getHours()))
  const settleTimer = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null))
  const stroke = useRef(/** @type {null | { x: number, y: number, distance: number, startedAt: number, purring: boolean, stretched: boolean, buzzedAt: number }} */ (null))
  const taps = useRef(/** @type {number[]} */ ([]))

  useEffect(() => () => { if (settleTimer.current) clearTimeout(settleTimer.current) }, [])
  useEffect(() => {
    const timer = setInterval(() => setNight(isNight(new Date().getHours())), 10 * 60 * 1000)
    return () => clearInterval(timer)
  }, [])

  const settle = (ms) => {
    if (settleTimer.current) clearTimeout(settleTimer.current)
    settleTimer.current = setTimeout(() => setFrame('sleep'), ms)
  }
  const holdStill = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current)
    settleTimer.current = null
  }
  const startPurr = (buzz) => {
    setFrame('purr')
    setPurrKey((key) => key + 1)
    if (buzz) purrBuzz()
  }

  // 翻页靠信纸上的左右滑：小猫身上的手势不往外传，摸它不会翻页
  const onPointerDown = (/** @type {import('react').PointerEvent<HTMLButtonElement>} */ event) => {
    event.stopPropagation()
    try { event.currentTarget.setPointerCapture?.(event.pointerId) } catch { /* 合成事件没有真实指针 */ }
    holdStill()
    stroke.current = { x: event.clientX, y: event.clientY, distance: 0, startedAt: Date.now(), purring: false, stretched: false, buzzedAt: 0 }
  }

  const onPointerMove = (/** @type {import('react').PointerEvent<HTMLButtonElement>} */ event) => {
    const current = stroke.current
    if (!current) return
    event.stopPropagation()
    current.distance += Math.hypot(event.clientX - current.x, event.clientY - current.y)
    current.x = event.clientX
    current.y = event.clientY
    const now = Date.now()
    if (!current.purring && current.distance >= STROKE_PX) {
      current.purring = true
      current.buzzedAt = now
      startPurr(true)
      return
    }
    if (!current.purring) return
    if (now - current.buzzedAt >= VIBRATE_EVERY_MS) {
      current.buzzedAt = now
      purrBuzz()
    }
    if (!current.stretched && now - current.startedAt >= LONG_STROKE_MS) {
      current.stretched = true
      setFrame('stretch')
    }
  }

  const onPointerUp = (/** @type {import('react').PointerEvent<HTMLButtonElement>} */ event) => {
    event.stopPropagation()
    const current = stroke.current
    stroke.current = null
    if (!current) return
    if (current.purring) {
      settle(current.stretched ? STRETCH_MS : SETTLE_MS)
      return
    }
    const now = Date.now()
    taps.current = [...taps.current.filter((at) => now - at < TAP_WINDOW_MS), now]
    if (taps.current.length >= TAP_BURST) {
      taps.current = []
      startPurr(true)
      settle(SETTLE_MS)
      return
    }
    setFrame('peek')
    settle(PEEK_MS)
  }

  const onPointerCancel = () => {
    stroke.current = null
    settle(SETTLE_MS)
  }

  // 键盘（回车 / 空格）按下产生的 click 没有指针：摸一下，呼噜一会儿
  const onClick = (/** @type {import('react').MouseEvent<HTMLButtonElement>} */ event) => {
    if (event.detail !== 0) return
    startPurr(false)
    settle(SETTLE_MS)
  }

  if (broken) return null

  const purring = frame === 'purr' || frame === 'stretch'
  return (
    <button
      type="button"
      aria-label="摸摸小猫"
      data-frame={frame}
      className="notebook-cat"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={onClick}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className="notebook-cat__body" aria-hidden="true">
        {FRAMES.map((name) => (
          <img
            key={name}
            src={frameSrc(name)}
            alt=""
            draggable={false}
            decoding="async"
            style={{ opacity: name === frame ? 1 : 0 }}
            onError={name === 'sleep' ? () => setBroken(true) : undefined}
          />
        ))}
      </span>
      {purring && <span key={purrKey} className="notebook-cat__purr" aria-hidden="true">呼噜呼噜…</span>}
      {night && frame === 'sleep' && !reducedMotion && <span className="notebook-cat__z" aria-hidden="true">z</span>}
      <span className="sr-only" aria-live="polite">{ANNOUNCE[frame] ?? ''}</span>
    </button>
  )
}
