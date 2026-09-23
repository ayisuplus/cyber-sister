import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DEFAULT_LINE, MARGIN_X, RIGHT_PAD, SNAP_SELECTOR, TEXT_INSET, pageGeometry, pageOf } from './pagedLayout'

// 翻一页用多久：700ms、减速、不回弹。CSS 里的 --flip-ms 要跟着改（globals.css「本子」一节）
const FLIP_MS = 700
const SWIPE_MIN = 48

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
  const [layout, setLayout] = useState({ pages: 0, pageWidth: 0, width: 0, hasCover, firstKey, lastKey, lastVersion })
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
    const next = { pages, pageWidth: geometry.pageWidth, width: viewport.clientWidth, hasCover, ...keysRef.current }
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

  // 手机上左右滑；鼠标不算（留给选字）
  const pointerRef = useRef(null)
  const onPointerDown = useCallback((event) => {
    pointerRef.current = event.pointerType === 'mouse' ? null : { x: event.clientX, y: event.clientY }
  }, [])
  const onPointerUp = useCallback((event) => {
    const start = pointerRef.current
    pointerRef.current = null
    if (!start) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 1.5) return
    if (dx < 0) goForward()
    else goBack()
  }, [goBack, goForward])

  return {
    refs: { viewportRef, stripRef, endRef, ghostHostRef },
    layout, index, ready, newPending, loadingOlder,
    canGoBack: index > firstIndex || (index === firstIndex && ((hasOlder && Boolean(onLoadOlder)) || hasCover)),
    canGoForward: index < lastIndex,
    goBack, goForward, showLatest,
    handlers: { onFocusCapture, onPointerDown, onPointerUp },
  }
}
