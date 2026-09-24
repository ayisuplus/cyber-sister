import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { bookStore } from '../../services/bookStore'

const isBook = (note) => note && typeof note.title === 'string' && Array.isArray(note.chapters)
const where = ({ title, chapters }) => `《${title}》${chapters.map((chapter) => chapter.origin).join('、')}`
const MIN_CARD = 96
// 下面剩的纸够摊开一张常见的小卡（四五行）就往下，不去盖她刚写的那一段
const ROOM_BELOW = 220

/** 一枚书签线稿：跟日期旁的小画一样是铅笔细线，关掉小装饰时一起收起 */
function BookmarkDoodle() {
  return (
    <svg viewBox="0 0 16 16" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="decor decor-doodle">
      <path d="M4.5 2.5h7v11l-3.5-2.6-3.5 2.6z" />
    </svg>
  )
}

/** 她自己放进书架的书，文件在不在这台设备上（在才能「翻到这一段」） */
function useLocalBook(bookId) {
  const [local, setLocal] = useState(false)
  useEffect(() => {
    let alive = true
    bookStore.listIds().then((ids) => { if (alive) setLocal(ids.has(bookId)) }).catch(() => {})
    return () => { alive = false }
  }, [bookId])
  return local
}

/** 她自己的书：没有「用途」和「没采纳」，注明 Amie 没审校；书在这台设备上时能翻到那一段 */
function UserBookNote({ book }) {
  const local = useLocalBook(book.bookId)
  return (
    <>
      <p>《{book.title}》{book.author ? ` · ${book.author}` : ''}</p>
      {book.chapters.map((chapter) => (
        <p key={chapter.id}>
          {chapter.origin}{chapter.title && chapter.title !== chapter.origin ? ` · ${chapter.title}` : ''}
          {local && chapter.locator && (
            <Link to={`/tools/reading/${book.bookId}?at=${encodeURIComponent(chapter.locator)}&from=margin`} className="letter-margin-note__jump">翻到这一段</Link>
          )}
        </p>
      ))}
      <p>这是你放进书架的书，Amie 没有审校它的内容。</p>
    </>
  )
}

/**
 * 小卡压在这一页上面，不挤动分页（挤动了，这一段会被推到下一页、本子也跟着翻走）。
 * 下面剩的纸够就往下摊，不够且上面更宽就往上；高度不超过那一侧剩下的纸，多了在卡里滚。
 */
function placeCard(note) {
  const page = note?.closest('.letter-viewport')
  if (!page) return { placement: 'below' }
  const line = note.getBoundingClientRect()
  const sheet = page.getBoundingClientRect()
  const below = sheet.bottom - line.bottom
  const above = line.top - sheet.top
  const placement = below >= Math.min(above, ROOM_BELOW) ? 'below' : 'above'
  return { placement, maxHeight: Math.max((placement === 'below' ? below : above) - 6, MIN_CARD) }
}

/**
 * 页边铅笔批注：她写这一段时翻过的书（路线图 C21；C22 起也有你放进书架的书）。
 * 只写「翻过」，不写「引用」：章是按你这句话挑出来放在她手边的，她不一定每一章都用上了。
 * 点一下，这一页上摊开一张书签小卡：书目、这一章在这里用来做什么、Amie 没采纳的部分和边界；
 * 你自己的书写是第几章、注明 Amie 没审校，书在这台设备上时可以翻到那一段。
 * 再点一下、点别处或按 Esc 收起。
 * @param {{ notes?: any }} props
 */
export default function MarginNote({ notes }) {
  const [card, setCard] = useState(null)
  const rootRef = useRef(null)
  const cardId = useId()

  useEffect(() => {
    if (!card) return undefined
    const closeOutside = (event) => { if (!rootRef.current?.contains(event.target)) setCard(null) }
    const closeOnEscape = (event) => { if (event.key === 'Escape') setCard(null) }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [card])

  const books = Array.isArray(notes) ? notes.filter(isBook) : []
  if (!books.length) return null
  const label = `翻过的书 · ${books.map(where).join('；')}`

  return (
    <div ref={rootRef} className="letter-margin-note">
      <button
        type="button"
        className="letter-margin-note__toggle"
        aria-expanded={Boolean(card)}
        aria-controls={cardId}
        // 读屏名称包含看得见的那一行，前面补一句是谁、什么时候翻的
        aria-label={`她写这段时${label}`}
        onClick={() => setCard(card ? null : placeCard(rootRef.current))}
      >
        <BookmarkDoodle />
        {label}
      </button>
      {card && (
        <div id={cardId} className="letter-margin-note__card" data-placement={card.placement} style={card.maxHeight ? { maxHeight: card.maxHeight } : undefined}>
          {books.map((book) => (
            <section key={book.book ?? book.title} className="letter-margin-note__book">
              {book.userBook ? <UserBookNote book={book} /> : (
                <>
                  <p>《{book.title}》{[book.author, book.edition].filter(Boolean).map((part) => ` · ${part}`).join('')}</p>
                  {book.chapters.map((chapter) => (
                    <p key={chapter.id}>{chapter.origin} · {chapter.title}：{chapter.use}</p>
                  ))}
                  {book.setAside && <p>没有采纳：{book.setAside}</p>}
                  {book.boundary && <p>{book.boundary}</p>}
                </>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
