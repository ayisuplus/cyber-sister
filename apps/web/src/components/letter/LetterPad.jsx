import { forwardRef, useImperativeHandle } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { usePagedLetter } from './usePagedLetter'
import { pageLabel } from './pagedLayout'

/**
 * 本子：一段对话写在信纸的横格上，写满一页就绕左边封线翻过去；不往下无限延伸。
 * 封面是第 0 页（空白对话打开时看到的那一页），页码从封面之后算起。
 * 所有内容都留在页面里、按顺序可读；翻页只是移动你看到的那一页。
 * ref.showLatest()：你刚写下一句时翻回最新一页。
 * @typedef {{ showLatest: () => void }} LetterPadHandle
 */
const LetterPad = forwardRef(/**
 * @param {{ children: import('react').ReactNode, cover?: import('react').ReactNode, firstKey?: string | null, lastKey?: string | null, lastVersion?: string | null, hasOlder?: boolean, onLoadOlder?: () => Promise<unknown> | void }} props
 * @param {import('react').ForwardedRef<LetterPadHandle>} ref
 */ function LetterPad({ children, cover = null, firstKey = null, lastKey = null, lastVersion = null, hasOlder = false, onLoadOlder }, ref) {
  const pad = usePagedLetter({ firstKey, lastKey, lastVersion, hasOlder, hasCover: Boolean(cover), onLoadOlder })
  const { viewportRef, stripRef, endRef, ghostHostRef } = pad.refs
  useImperativeHandle(ref, () => ({ showLatest: pad.showLatest }), [pad.showLatest])

  // 翻到第几页，就把纸带往左挪几张纸宽；封面那一页底下还是第一页，不动
  const offset = Math.max(0, pad.index - (cover ? 1 : 0)) * pad.layout.pageWidth
  const label = pageLabel(pad.index, pad.layout.pages, Boolean(cover))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 翻页时那一页绕左边封线翻过来，翻出纸外的部分裁掉：不压到页头和页码 */}
      <div className="relative min-h-0 flex-1 overflow-clip">
        <div
          ref={viewportRef}
          role="region"
          aria-label="信纸"
          data-ready={pad.ready ? 'true' : 'false'}
          data-cover={cover ? 'true' : 'false'}
          className="letter-viewport absolute inset-0"
          onFocusCapture={pad.handlers.onFocusCapture}
          onPointerDown={pad.handlers.onPointerDown}
          onPointerUp={pad.handlers.onPointerUp}
        >
          <div ref={stripRef} className="letter-strip" style={{ transform: offset ? `translateX(-${offset}px)` : 'none' }}>
            {children}
            <span ref={endRef} aria-hidden="true" className="letter-end" />
          </div>
          {/* 封面压在最上面：翻开它才是第一封信 */}
          {cover && pad.index === 0 && <div className="letter-cover-page">{cover}</div>}
        </div>
        <div ref={ghostHostRef} aria-hidden="true" className="letter-ghost-host pointer-events-none absolute inset-0 z-10" />
        {pad.newPending && (
          <button type="button" onClick={pad.showLatest} className="letter-new absolute bottom-2 right-3 z-20">
            她回信了 · 翻到最新一页
          </button>
        )}
      </div>
      <nav aria-label="翻页" className="letter-nav">
        <button type="button" aria-label="上一页" disabled={!pad.canGoBack || pad.loadingOlder} onClick={pad.goBack} className="letter-nav__button">
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <span aria-live="polite" className="letter-nav__label">
          <span aria-hidden="true">{pad.loadingOlder ? '正在翻出更早的信…' : label.text}</span>
          <span className="sr-only">{pad.loadingOlder ? '正在翻出更早的信' : label.sr}</span>
        </span>
        <button type="button" aria-label="下一页" disabled={!pad.canGoForward} onClick={pad.goForward} className="letter-nav__button">
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </nav>
    </div>
  )
})

export default LetterPad
