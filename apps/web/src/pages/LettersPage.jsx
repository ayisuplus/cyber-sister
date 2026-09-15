import { useEffect, useState } from 'react'
import { ChevronDown, Mail, MailOpen } from 'lucide-react'
import Header from '../components/layout/Header'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import SourceBadge from '../components/ui/SourceBadge'
import { letterService } from '../services/letterService'

const formatWeekStart = (weekStart) => {
  const date = new Date(weekStart)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

// 历史信件与模拟预览分别展示，预览不会进入信箱。
// embedded：作为「手记」页签嵌入时不渲染自己的页头
export default function LettersPage({ embedded = false } = {}) {
  const [letters, setLetters] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [openId, setOpenId] = useState(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [preview, setPreview] = useState(null)
  const [previewError, setPreviewError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    setLoadError('')
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
  }, [reloadTick])

  const generatePreview = async () => {
    if (generating) return
    setGenerating(true); setPreviewError(''); setPreview(null)
    try {
      const result = await letterService.generate()
      if (result.execution?.mode === 'mock') setPreview(result.preview)
      else if (result.letter) setReloadTick(tick => tick + 1)
      else setPreviewError('这次没有生成信件，请稍后重试')
    } catch (error) { setPreviewError(error?.response?.data?.error || '预览失败，请重试') }
    finally { setGenerating(false) }
  }

  return (
    <div className="flex-1 flex flex-col bg-transparent overflow-hidden">
      {!embedded && <Header title="她的信" showBack />}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <p className="px-1 text-xs leading-relaxed text-text-secondary">
          这里保留你已有的来信。云端写信服务尚未连接，可以先预览接口返回的示例。
        </p>
        <Button disabled={generating} onClick={generatePreview}>{generating ? '正在预览…' : '预览一封信'}</Button>
        {previewError && <p role="alert" className="text-sm text-danger">{previewError}</p>}
        {preview && <section aria-label="模拟来信预览" className="rounded-card border border-border-default bg-pastel-mist p-4">
          <SourceBadge source="cloud_mock" />
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-text-primary">{preview.content}</p>
          <p className="mt-2 text-xs text-text-muted">这封示例不会保存到你的信箱。</p>
        </section>}

        {loading ? (
          <p role="status" className="py-8 text-center text-sm text-text-muted">加载中…</p>
        ) : loadError ? (
          <div className="py-8 text-center">
            <p role="alert" className="text-sm text-danger">{loadError}</p>
            <Button variant="secondary" className="mt-3" onClick={() => setReloadTick(tick => tick + 1)}>重试</Button>
          </div>
        ) : letters.length === 0 ? (
          <EmptyState
            icon={Mail}
            title="信箱还空着"
            description="云端写信接通后，新来信会出现在这里。"
          />
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
