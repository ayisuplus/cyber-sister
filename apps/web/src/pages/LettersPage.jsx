import { useEffect, useState } from 'react'
import { ChevronDown, Mail, MailOpen } from 'lucide-react'
import Header from '../components/layout/Header'
import { letterService } from '../services/letterService'

const formatWeekStart = (weekStart) => {
  const date = new Date(weekStart)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

// 「她的信」：每周一封，内容全部由本周真实数据生成；最新一封默认展开，旧的点击开合。
export default function LettersPage() {
  const [letters, setLetters] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [openId, setOpenId] = useState(null)

  useEffect(() => {
    let alive = true
    letterService.list()
      .then((data) => {
        if (!alive) return
        const list = Array.isArray(data?.letters) ? data.letters : []
        setLetters(list)
        setOpenId(list[0]?.id ?? null)
      })
      .catch(() => { if (alive) setLoadError('加载失败，请检查网络后重试') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  return (
    <div className="flex-1 flex flex-col bg-transparent overflow-hidden">
      <Header title="她的信" showBack />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <p className="px-1 text-xs leading-relaxed text-text-secondary">
          每周一封，只写你这周真实发生的事。不会外发任何内容给模型，全在这台服务器上生成。
        </p>

        {loading ? (
          <p role="status" className="py-8 text-center text-sm text-text-muted">加载中…</p>
        ) : loadError ? (
          <p role="alert" className="py-8 text-center text-sm text-danger">{loadError}</p>
        ) : letters.length === 0 ? (
          <div className="py-10 text-center">
            <Mail size={44} className="mx-auto mb-3 text-text-muted" />
            <p className="text-sm text-text-muted">还没到能写信的时候——多聊几句、记点什么，她就有话写了。</p>
          </div>
        ) : (
          letters.map((letter) => {
            const open = letter.id === openId
            return (
              <article key={letter.id} className="rounded-card bg-surface-card shadow-card overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : letter.id)}
                  aria-expanded={open}
                  className="flex min-h-14 w-full items-center gap-3 px-4 text-left"
                >
                  {open
                    ? <MailOpen size={18} className="shrink-0 text-action-primary" aria-hidden="true" />
                    : <Mail size={18} className="shrink-0 text-text-muted" aria-hidden="true" />}
                  <span className="flex-1 text-sm font-semibold text-text-primary">{formatWeekStart(letter.weekStart)}那周的信</span>
                  <ChevronDown size={15} className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
                {open && (
                  <p className="whitespace-pre-line border-t border-border-subtle px-4 py-4 text-sm leading-relaxed text-text-primary">
                    {letter.content}
                  </p>
                )}
              </article>
            )
          })
        )}
      </div>
    </div>
  )
}
