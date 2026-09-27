import { useEffect, useRef, useState } from 'react'

// 摸一摸的手势：本子角上的小家伙与宠物页共用。
// 轻点 → peek（醒一下）；按住来回摸或连点三下 → purr（呼噜，手机上轻震）；一直摸 → stretch；键盘回车 → purr。
// 一段手势只在进入呼噜那一刻调一次 onPurr，外面据此去服务端记一次好感。

const STROKE_PX = 48          // 按住来回摸，累计移动这么远就算在摸
const LONG_STROKE_MS = 2500   // 一直摸这么久，伸个懒腰
const TAP_BURST = 3           // 连点这么多下也算在摸
const TAP_WINDOW_MS = 1500
const PEEK_MS = 1200
const SETTLE_MS = 1500
const STRETCH_MS = 1500
const VIBRATE_EVERY_MS = 1200
const PURR_PATTERN = [12, 40, 12, 40, 12]

function purrBuzz() {
  try {
    navigator.vibrate?.(PURR_PATTERN)
  } catch {
    // 不支持震动的设备（比如 iPhone 的 Safari）就只有画面
  }
}

/**
 * @param {{ onPurr?: () => void }} [options]
 * @returns {{ mood: 'idle' | 'peek' | 'purr' | 'stretch', purrKey: number, handlers: Record<string, Function> }}
 */
export function usePetting({ onPurr } = {}) {
  const [mood, setMood] = useState(/** @type {'idle' | 'peek' | 'purr' | 'stretch'} */ ('idle'))
  const [purrKey, setPurrKey] = useState(0)
  const onPurrRef = useRef(onPurr)
  const settleTimer = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null))
  const stroke = useRef(/** @type {null | { x: number, y: number, distance: number, startedAt: number, purring: boolean, stretched: boolean, buzzedAt: number }} */ (null))
  const taps = useRef(/** @type {number[]} */ ([]))

  useEffect(() => { onPurrRef.current = onPurr }, [onPurr])
  useEffect(() => () => { if (settleTimer.current) clearTimeout(settleTimer.current) }, [])

  const settle = (/** @type {number} */ ms) => {
    if (settleTimer.current) clearTimeout(settleTimer.current)
    settleTimer.current = setTimeout(() => setMood('idle'), ms)
  }
  const holdStill = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current)
    settleTimer.current = null
  }
  const startPurr = (/** @type {boolean} */ buzz) => {
    setMood('purr')
    setPurrKey((key) => key + 1)
    if (buzz) purrBuzz()
    onPurrRef.current?.()
  }

  // 翻页靠信纸上的左右滑：摸它的手势不往外传，摸它不会翻页
  const onPointerDown = (/** @type {import('react').PointerEvent<HTMLElement>} */ event) => {
    event.stopPropagation()
    try { event.currentTarget.setPointerCapture?.(event.pointerId) } catch { /* 合成事件没有真实指针 */ }
    holdStill()
    stroke.current = { x: event.clientX, y: event.clientY, distance: 0, startedAt: Date.now(), purring: false, stretched: false, buzzedAt: 0 }
  }

  const onPointerMove = (/** @type {import('react').PointerEvent<HTMLElement>} */ event) => {
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
      setMood('stretch')
    }
  }

  const onPointerUp = (/** @type {import('react').PointerEvent<HTMLElement>} */ event) => {
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
    setMood('peek')
    settle(PEEK_MS)
  }

  const onPointerCancel = () => {
    stroke.current = null
    settle(SETTLE_MS)
  }

  // 键盘（回车 / 空格）按下产生的 click 没有指针：摸一下，呼噜一会儿
  const onClick = (/** @type {import('react').MouseEvent<HTMLElement>} */ event) => {
    if (event.detail !== 0) return
    startPurr(false)
    settle(SETTLE_MS)
  }

  const onContextMenu = (/** @type {import('react').MouseEvent<HTMLElement>} */ event) => event.preventDefault()

  return { mood, purrKey, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClick, onContextMenu } }
}
