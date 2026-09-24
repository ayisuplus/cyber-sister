import { useNavigate } from 'react-router-dom'
import Card from '../ui/Card'

/** 一摞书的线稿：跟页边批注的书签一样是铅笔细线，关掉小装饰时一起收起 */
function BooksDoodle() {
  return (
    <svg viewBox="0 0 20 16" width={16} height={13} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="decor decor-doodle text-text-muted">
      <path d="M2.5 14.5h15M4 14.5V4.5h3v10M7 14.5V2.5h3v12M11.2 14.3l2.4-10.6 2.9.7-2.4 10.6" />
    </svg>
  )
}

/**
 * 「Amie 的藏书」：Amie 按书改编的章节。聊天时和你放进来的书一起翻，只读。
 * @param {{ books: Array<{ name: string, title: string, author?: string, chapters: unknown[] }> }} props
 */
export default function BuiltinShelf({ books }) {
  const navigate = useNavigate()
  if (!books.length) return null
  return (
    <section aria-labelledby="shelf-builtin" className="space-y-2">
      <h2 id="shelf-builtin" className="flex items-center gap-1.5 px-1 text-sm font-semibold text-text-primary">
        <BooksDoodle />
        Amie 的藏书
      </h2>
      <p className="px-1 text-xs leading-relaxed text-text-muted">Amie 按书改编的章节，不是原书。聊天时她会按你说的话翻到相关的一章。</p>
      <ul className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
        {books.map((book) => (
          <li key={book.name}>
            <Card className="p-0">
              <button type="button" onClick={() => navigate(`/tools/reading/shelf/${book.name}`)} className="min-h-11 w-full rounded-card p-4 text-left">
                <span className="block truncate text-sm font-semibold text-text-primary">《{book.title}》</span>
                <span className="mt-1 block truncate text-xs text-text-muted">
                  {[book.author, `${book.chapters.length} 章改编`].filter(Boolean).join(' · ')}
                </span>
              </button>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  )
}
