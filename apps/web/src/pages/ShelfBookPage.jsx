import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import Header from '../components/layout/Header'
import Card from '../components/ui/Card'
import { readingService } from '../services/readingService'

// Amie 的藏书，点开一本（路线图 C22）：她按书改编的章节，就是聊天时她翻到的那些文字。
// 只读；不是原书，也不是作者本人写的。
const withoutHeading = (content) => String(content || '').replace(/^#\s+.*\n+/, '')

export default function ShelfBookPage() {
  const { name } = useParams()
  const navigate = useNavigate()
  const [book, setBook] = useState(null)
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    setLoadError('')
    try {
      setBook(await readingService.getShelfBook(name))
    } catch {
      setLoadError('这本书没打开，回书架看看')
    }
  }, [name])

  useEffect(() => { load() }, [load])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
      <Header title={book ? `《${book.title}》` : 'Amie 的藏书'} showBack />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {loadError ? (
          <p role="alert" className="py-8 text-center text-sm text-danger">
            {loadError}
            <button type="button" className="ml-2 min-h-11 underline" onClick={() => navigate('/tools/reading')}>回书架</button>
          </p>
        ) : !book ? <p role="status" className="py-8 text-center text-sm text-text-muted">加载中…</p> : (
          <>
            <Card className="space-y-2 p-4 text-xs leading-relaxed text-text-secondary">
              <p className="text-sm text-text-primary">{[book.author, book.edition].filter(Boolean).join(' · ')}</p>
              {book.boundary && <p>{book.boundary}</p>}
              {book.setAside && <p className="text-text-muted">没有采纳：{book.setAside}</p>}
            </Card>
            <ul className="space-y-2">
              {book.chapters.map((chapter) => (
                <li key={chapter.id}>
                  <Card className="p-0">
                    <details className="group">
                      <summary className="flex min-h-11 cursor-pointer list-none flex-col justify-center rounded-card px-4 py-3">
                        <span className="text-sm font-semibold text-text-primary">{chapter.title}</span>
                        <span className="mt-1 text-xs text-text-muted">原书{chapter.origin} · {chapter.use}</span>
                      </summary>
                      <div className="message-markdown border-t border-border-subtle px-4 py-3 text-sm leading-relaxed text-text-primary">
                        <ReactMarkdown skipHtml>{withoutHeading(chapter.content)}</ReactMarkdown>
                      </div>
                    </details>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
