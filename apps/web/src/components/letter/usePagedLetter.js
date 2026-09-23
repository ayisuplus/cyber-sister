import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DEFAULT_LINE, MARGIN_X, RIGHT_PAD, SNAP_SELECTOR, TEXT_INSET, pageGeometry, pageOf } from './pagedLayout'

// 翻一页用多久：700ms、减速、不回弹。CSS 里的 --flip-ms 要跟着改（globals.css「本子」一节）
const FLIP_MS = 700
const SWIPE_MIN = 48
// 用手指翻：横着走够这么远才算开始翻（再短当成点按）；拖过这么多页宽、或甩得这么快（像素/毫秒），松手就翻过去
const DRAG_LOCK = 10
const DRAG_COMMIT = 0.35
const FLICK = 0.45
const SETTLE_MIN_MS = 160
const SETTLE_MAX_MS = 520

const isEditable = (target) => target instanceof HTMLElement
  && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

/** 照片、卡片、便签这些不是一行行字的东西，把高度补到整数行，后面的字才不会压线。 */
function snapToLines(strip, line) {
  for (const element of strip.querySelectorAll(SNAP_SELECTOR)) {
    element.style.minHeight = ''
    const height = element.getBoundingClientRect().height
    if (height > 0) element.style.minHeight = `${Math.ceil(height / line - 0.01) * line}px`
  }
}

/**
 * 危机干预落在哪几页（从 0 数，逗号分隔，方便比较）：这些页上不贴任何小装饰。
 * 一段话可能被分到两页，所以按它的每一截（getClientRects）算。
 */
function quietPagesOf(strip, geometry) {
  const left = strip.getBoundingClientRect().left
  const pages = new Set()
  for (const element of strip.querySelectorAll('[data-quiet="true"]')) {
    for (const rect of element.getClientRects()) pages.add(pageOf(rect.left - left, geometry))
  }
  return [...pages].sort((a, b) => a - b).join(',')
}

/** 纸带里有没有真的写出东西：空对话只剩一枚结尾标记，那就一页都没有，只看得到封面。 */
function stripHasContent(strip) {
  for (const element of strip.children) {
    if (element.classList.contains('letter-end')) continue
    if (element.getClientRects().length) return true
  }
  return false
}

/** 把眼前这一页拓印一份：不可交互、对读屏隐藏，只用来翻。 */
function copyPage(viewport, direction) {
  const ghost = viewport.cloneNode(true)
  ghost.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'))
  ghost.removeAttribute('role')
  ghost.removeAttribute('aria-label')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.inert = true
  ghost.classList.add('letter-ghost')
  if (direction) ghost.classList.add(`letter-ghost--${direction}`)
  return ghost
}

const drop = (ghost, below) => () => { ghost.remove(); below?.remove() }

const prefersReducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)

// 手指走过的比例 → 这一页转到哪（--turn：0 平摊着，1 翻到左边去）。纸的外边缘在「宽 × cos(π·turn)」，
// 这样算，边缘始终停在手指底下：往左拖是 0 → 0.5（立起来），往右拖把上一页从 0.5 翻回 0
const forwardTurn = (progress) => Math.acos(1 - progress) / Math.PI
const backTurn = (progress) => Math.acos(progress) / Math.PI

/** 跟着手指翻的那一页：拓印一份，转到哪由 --turn 决定（样式在 globals.css「用手指翻」）。 */
function copyLeaf(viewport, turn) {
  const leaf = copyPage(viewport)
  leaf.classList.add('letter-ghost--leaf')
  leaf.style.setProperty('--turn', String(turn))
  return leaf
}

/**
 * 松手后让这一页顺势翻完或落回去：只减速、不回弹。
 * 最多 120 帧（标签页在后台、不跑 rAF 时由定时器收尾）。返回「立刻落定」的函数。
 */
function settleLeaf(leaf, from, to, done) {
  const duration = Math.round(Math.min(SETTLE_MAX_MS, Math.max(SETTLE_MIN_MS, Math.abs(to - from) * 900)))
  const start = performance.now()
  let frames = 0
  let finished = false
  let timer = 0
  const finish = () => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    leaf?.style.setProperty('--turn', String(to))
    done()
  }
  const step = () => {
    if (finished) return
    const k = Math.min(1, (performance.now() - start) / duration)
    leaf?.style.setProperty('--turn', String(from + (to - from) * (1 - (1 - k) ** 3)))
    frames += 1
    if (k >= 1 || frames >= 120) finish()
    else requestAnimationFrame(step)
  }
  timer = setTimeout(finish, duration + 120)
  requestAnimationFrame(step)
  return finish
}

/** 往后翻：眼前这一页绕左边封线翻过去，底下已经是新的一页。 */
function turnForward(host, viewport) {
  if (!host || !viewport?.clientWidth) return
  const ghost = copyPage(viewport, 'forward')
  host.replaceChildren(ghost)
  const done = drop(ghost)
  ghost.addEventListener('animationend', done, { once: true })
  setTimeout(done, FLIP_MS + 200)
}

/** 往前翻第一层：旧页先静静压在上面，免得底下新的一页先露出来。 */
function layStillPage(host, viewport) {
  if (!host || !viewport?.clientWidth) return
  host.replaceChildren(copyPage(viewport))
}

/** 往前翻第二层：新的一页从左边翻回来盖上旧页的静影，落定后两层一起撤掉。 */
function turnBack(host, viewport) {
  const still = host.firstElementChild
  if (!viewport?.clientWidth) { host.replaceChildren(); return }
  const ghost = copyPage(viewport, 'back')
  host.append(ghost)
  const done = drop(ghost, still)
  ghost.addEventListener('animationend', done, { once: true })
  setTimeout(done, FLIP_MS + 200)
}

/**
 * 信纸的分页与翻页。内容用 CSS 分栏流成一页一页（一栏就是一页），这里只负责量尺寸、算页数、决定翻到哪。
 * - 封面是第 0 页：纸带前面凭空多一页，页码从封面之后算起；空对话时只看得到封面。
 * - 在最后一页时，新写的字把这一页写满就自动翻过去；在往回翻看时不拽走你，只亮出「翻到最新一页」。
 * - 翻到最早的一页再往前：先取更早的信，没有更早的就回到封面。
 * - 翻页绕左边封线：往后翻是眼前这一页翻过去；往前翻是新的一页从左边翻回来盖住旧页。
 * lastVersion：最后一段写到哪了（新的一段、流式多写了几个字）。只有它变了引起的翻页才播动画；
 * 字体到了、版面重排这类翻页直接到位，不假装是「写满了」。
 * @param {{ firstKey?: string | null, lastKey?: string | null, lastVersion?: string | null, hasOlder?: boolean, hasCover?: boolean, onLoadOlder?: () => Promise<unknown> | void }} options
 */
export function usePagedLetter({ firstKey = null, lastKey = null, lastVersion = null, hasOlder = false, hasCover = false, onLoadOlder } = {}) {
  const viewportRef = useRef(null)
  const stripRef = useRef(null)
  const endRef = useRef(null)
  const ghostHostRef = useRef(null)
  const [layout, setLayout] = useState({ pages: 0, pageWidth: 0, width: 0, hasCover, quietPages: '', firstKey, lastKey, lastVersion })
  const [index, setIndex] = useState(0)
  const [ready, setReady] = useState(false)
  const [newPending, setNewPending] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const indexRef = useRef(0)
  const lastIndexRef = useRef(0)
  const layoutRef = useRef(layout)
  const geometryRef = useRef(null)
  const followRef = useRef(true)
  // 往回翻时发起取更早的信：记下当时的第一条，取回来时对得上才往前翻一页
  const wantBackFromRef = useRef(null)
  const initializedRef = useRef(false)
  // 往前翻要先铺旧页的静影，等新页画出来再拓第二层
  const backFlipRef = useRef(false)
  const keysRef = useRef({ firstKey, lastKey, lastVersion })
  const frameRef = useRef(0)
  // 有封面时第 0 页是封面，信纸从第 1 页起
  const firstIndex = hasCover ? 1 : 0
  const lastIndex = Math.max(0, layout.pages - (hasCover ? 0 : 1))
  indexRef.current = index
  lastIndexRef.current = lastIndex
  layoutRef.current = layout
  keysRef.current = { firstKey, lastKey, lastVersion }

  const measure = useCallback(() => {
    const viewport = viewportRef.current
    const strip = stripRef.current
    const end = endRef.current
    if (!viewport || !strip || !end) return
    // 行高与左右留白以 CSS 为准（窄屏会收紧），这里只读不算
    const styles = getComputedStyle(viewport)
    const line = parseFloat(styles.getPropertyValue('--line')) || DEFAULT_LINE
    const marginX = parseFloat(styles.getPropertyValue('--margin-x')) || MARGIN_X
    const textInset = parseFloat(styles.getPropertyValue('--text-inset')) || TEXT_INSET
    const rightPad = parseFloat(styles.getPropertyValue('--right-pad')) || RIGHT_PAD
    const geometry = pageGeometry(viewport.clientWidth, viewport.clientHeight, line, marginX + textInset, rightPad)
    geometryRef.current = geometry
    // 量不出尺寸（比如测试环境）就只有一页，不平移
    if (!geometry) { setReady(true); return }
    Object.assign(strip.style, {
      width: `${geometry.stripWidth}px`, height: `${geometry.pageHeight}px`,
      columnWidth: `${geometry.columnWidth}px`, columnGap: `${geometry.gap}px`,
      top: `${line}px`, left: `${marginX + textInset}px`,
    })
    viewport.style.setProperty('--page-h', `${geometry.pageHeight}px`)
    snapToLines(strip, line)
    // 空对话时纸带里什么都没写：一页都没有，打开就是合上的本子
    const pages = stripHasContent(strip)
      ? pageOf(end.getBoundingClientRect().left - strip.getBoundingClientRect().left, geometry) + 1
      : 0
    const next = { pages, pageWidth: geometry.pageWidth, width: viewport.clientWidth, hasCover, quietPages: quietPagesOf(strip, geometry), ...keysRef.current }
    setLayout((previous) => (Object.keys(next).every((key) => previous[key] === next[key]) ? previous : next))
  }, [hasCover])

  const schedule = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(measure)
  }, [measure])

  // 尺寸变了（键盘弹起、转屏）、内容变了（流式回复、翻出更早的信）、字体到了、照片加载完，都重新分页
  useEffect(() => {
    const viewport = viewportRef.current
    const strip = stripRef.current
    schedule()
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
    resize?.observe(viewport)
    const mutation = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null
    mutation?.observe(strip, { childList: true, subtree: true, characterData: true })
    strip?.addEventListener('load', schedule, true)
    const fonts = document.fonts
    fonts?.addEventListener?.('loadingdone', schedule)
    fonts?.ready?.then(schedule).catch(() => {})
    return () => {
      cancelAnimationFrame(frameRef.current)
      resize?.disconnect()
      mutation?.disconnect()
      strip?.removeEventListener('load', schedule, true)
      fonts?.removeEventListener?.('loadingdone', schedule)
    }
  }, [schedule])

  const flipTo = useCallback((target, animate = true) => {
    const last = lastIndexRef.current
    const next = Math.max(0, Math.min(last, target))
    followRef.current = next === last
    if (next === last) setNewPending(false)
    if (next === indexRef.current) return
    if (animate) {
      if (next > indexRef.current) turnForward(ghostHostRef.current, viewportRef.current)
      else {
        layStillPage(ghostHostRef.current, viewportRef.current)
        backFlipRef.current = true
      }
    }
    setIndex(next)
  }, [])

  // 往前翻的第二层：等新的一页画出来（这一帧里纸带已经移到位），再把它拓印成翻动层
  useLayoutEffect(() => {
    if (!backFlipRef.current) return undefined
    backFlipRef.current = false
    const frame = requestAnimationFrame(() => turnBack(ghostHostRef.current, viewportRef.current))
    return () => cancelAnimationFrame(frame)
  }, [index])

  // 用手指往右拖：上一页画出来了，才把它拓印成跟着手指翻回来的那一页
  const dragRef = useRef(null)
  const settleRef = useRef(null)
  const clearOnCommitRef = useRef(false)
  useLayoutEffect(() => {
    const drag = dragRef.current
    if (!drag?.awaitingLeaf) return
    drag.awaitingLeaf = false
    drag.leaf = copyLeaf(viewportRef.current, backTurn(drag.progress))
    ghostHostRef.current?.append(drag.leaf)
  }, [index])
  // 拖得不够、落回原处：底下已经换回原来那一页了，这时撤掉拓印才不会闪一下
  useLayoutEffect(() => {
    if (!clearOnCommitRef.current) return
    clearOnCommitRef.current = false
    ghostHostRef.current?.replaceChildren()
  }, [index])

  // 封面压在上面时，底下的信纸不该再被点到或读到
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    if (hasCover && index === 0) strip.setAttribute('inert', '')
    else strip.removeAttribute('inert')
  }, [hasCover, index])

  // 版面变了之后决定停在哪一页
  const previousLayoutRef = useRef(null)
  useEffect(() => {
    const previous = previousLayoutRef.current
    previousLayoutRef.current = layout
    if (!layout.width) return
    const last = lastIndexRef.current
    if (!initializedRef.current) {
      initializedRef.current = true
      setIndex(last)
      setReady(true)
      return
    }
    const prepended = previous && previous.firstKey != null && previous.firstKey !== layout.firstKey && layout.pages > previous.pages
    if (prepended) {
      // 翻出了更早的信：页码往后挪相应的页数；若是往回翻时取的，再往前翻一页
      const back = wantBackFromRef.current === previous.firstKey
      wantBackFromRef.current = null
      const target = indexRef.current + (layout.pages - previous.pages) - (back ? 1 : 0)
      if (back) flipTo(target, true)
      else setIndex(target)
      return
    }
    if (followRef.current) {
      flipTo(last, Boolean(previous) && previous.lastVersion !== layout.lastVersion)
      return
    }
    if (previous && previous.lastKey !== layout.lastKey) setNewPending(true)
    if (indexRef.current > last) setIndex(last)
  }, [layout, flipTo])

  const goForward = useCallback(() => flipTo(indexRef.current + 1, true), [flipTo])

  const goBack = useCallback(async () => {
    if (indexRef.current > firstIndex) { flipTo(indexRef.current - 1, true); return }
    if (hasOlder && onLoadOlder && !loadingOlder) {
      wantBackFromRef.current = keysRef.current.firstKey
      setLoadingOlder(true)
      try {
        await onLoadOlder()
      } finally {
        setLoadingOlder(false)
      }
      return
    }
    // 翻过最早的信就回到封面
    if (hasCover && indexRef.current === firstIndex) flipTo(0, true)
  }, [flipTo, firstIndex, hasCover, hasOlder, loadingOlder, onLoadOlder])

  const showLatest = useCallback(() => flipTo(lastIndexRef.current, true), [flipTo])

  // 键盘：← → 与 PageUp / PageDown；在输入框里、或有弹窗开着时不响应
  useEffect(() => {
    const onKey = (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isEditable(event.target)) return
      if (document.querySelector('[aria-modal="true"]')) return
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); goBack() }
      if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); goForward() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [goBack, goForward])

  // 用 Tab 把焦点移到别的页上的链接或按钮时，翻到那一页；纸本身不许被浏览器偷偷滚动
  const onFocusCapture = useCallback((event) => {
    const viewport = viewportRef.current
    if (viewport) { viewport.scrollLeft = 0; viewport.scrollTop = 0 }
    const geometry = geometryRef.current
    const strip = stripRef.current
    if (!geometry || !strip || !(event.target instanceof HTMLElement)) return
    const page = pageOf(event.target.getBoundingClientRect().left - strip.getBoundingClientRect().left, geometry)
    const target = page + firstIndex
    if (target !== indexRef.current) flipTo(target, false)
  }, [flipTo, firstIndex])

  // 用手指翻：往左拖，眼前这一页跟着手指翻起来；往右拖，上一页从左边翻回来。拓印那一页的外边缘一直停在手指底下
  const beginDrag = useCallback((drag, direction) => {
    const viewport = viewportRef.current
    const host = ghostHostRef.current
    if (!viewport?.clientWidth || !host) return false
    const from = indexRef.current
    let target
    if (direction === 'forward') {
      if (from >= lastIndexRef.current) return false
      target = from + 1
    } else if (from > firstIndex) {
      target = from - 1
    } else if (from === firstIndex && hasCover && !(hasOlder && onLoadOlder)) {
      // 翻过最早的信就回到封面；还有更早的信时交给松手时的「往前翻」去取
      target = 0
    } else {
      return false
    }
    Object.assign(drag, { direction, from, width: viewport.clientWidth })
    if (direction === 'forward') {
      drag.leaf = copyLeaf(viewport, 0)
      host.replaceChildren(drag.leaf)
    } else {
      // 先铺一层眼前这一页的静影，底下换成上一页；上一页画出来后再拓印成跟手的那一页
      host.replaceChildren(copyPage(viewport))
      drag.awaitingLeaf = true
    }
    flipTo(target, false)
    return true
  }, [firstIndex, flipTo, hasCover, hasOlder, onLoadOlder])

  // 松手：拖过三分之一多页宽、或者甩了一下，就顺势翻过去；不然落回原处
  const finishDrag = useCallback((drag, cancelled = false) => {
    const forward = drag.direction === 'forward'
    const flick = forward ? -drag.velocity : drag.velocity
    const commit = !cancelled && (drag.progress > DRAG_COMMIT || flick > FLICK)
    const leaf = drag.leaf
    const from = Number.parseFloat(leaf?.style.getPropertyValue('--turn') ?? '')
    const current = Number.isFinite(from) ? from : (forward ? 0 : 0.5)
    // 往左拖：翻过去是 1、落回来是 0；往右拖：翻回来是 0、退回去是 1
    const to = forward ? (commit ? 1 : 0) : (commit ? 0 : 1)
    drag.awaitingLeaf = false
    settleRef.current = settleLeaf(leaf, current, to, () => {
      settleRef.current = null
      if (commit) {
        ghostHostRef.current?.replaceChildren()
        return
      }
      clearOnCommitRef.current = true
      flipTo(drag.from, false)
    })
  }, [flipTo])

  // 手机上左右滑；鼠标不算（留给选字）。横着拖就跟手翻；没来得及拖（一下就松手）的，照旧按滑动翻页
  const pointerRef = useRef(null)
  const onPointerDown = useCallback((event) => {
    // 上一次还在落定的途中：这一下不接，免得两页叠在一起
    if (event.pointerType === 'mouse' || settleRef.current) {
      pointerRef.current = null
      dragRef.current = null
      return
    }
    pointerRef.current = { x: event.clientX, y: event.clientY }
    dragRef.current = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      lastX: event.clientX, lastT: event.timeStamp, velocity: 0, progress: 0, direction: null,
    }
  }, [])
  const onPointerMove = useCallback((event) => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.id) return
    const elapsed = event.timeStamp - drag.lastT
    if (elapsed > 0) drag.velocity = (event.clientX - drag.lastX) / elapsed
    drag.lastX = event.clientX
    drag.lastT = event.timeStamp
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (!drag.direction) {
      // 横着走够一点才算开始翻；竖着走是在滚动，不归翻页管；减少动态效果时不跟手，松手再换页
      if (Math.abs(dx) < DRAG_LOCK || prefersReducedMotion()) return
      if (Math.abs(dx) < Math.abs(dy) * 1.2 || !beginDrag(drag, dx < 0 ? 'forward' : 'back')) {
        dragRef.current = null
        return
      }
      event.currentTarget?.setPointerCapture?.(event.pointerId)
      pointerRef.current = null
    }
    drag.progress = Math.max(0, Math.min(1, (drag.direction === 'forward' ? -dx : dx) / drag.width))
    drag.leaf?.style.setProperty('--turn', String(drag.direction === 'forward' ? forwardTurn(drag.progress) : backTurn(drag.progress)))
  }, [beginDrag])
  const onPointerUp = useCallback((event) => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag?.direction) {
      // 手指停住了才松开：停住的那段时间没有移动事件，不能还按停住之前的速度算成「甩了一下」
      if (event.timeStamp - drag.lastT > 80) drag.velocity = 0
      finishDrag(drag)
      return
    }
    const start = pointerRef.current
    pointerRef.current = null
    if (!start) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 1.5) return
    if (dx < 0) goForward()
    else goBack()
  }, [finishDrag, goBack, goForward])
  // 被系统打断（来电、手势被浏览器接走）：拖到一半的那一页落回原处
  const onPointerCancel = useCallback(() => {
    const drag = dragRef.current
    dragRef.current = null
    pointerRef.current = null
    if (drag?.direction) finishDrag(drag, true)
  }, [finishDrag])

  return {
    refs: { viewportRef, stripRef, endRef, ghostHostRef },
    layout, index, ready, newPending, loadingOlder,
    canGoBack: index > firstIndex || (index === firstIndex && ((hasOlder && Boolean(onLoadOlder)) || hasCover)),
    canGoForward: index < lastIndex,
    goBack, goForward, showLatest,
    handlers: { onFocusCapture, onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  }
}
