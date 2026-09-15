import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { Box, ChevronLeft, ImagePlus } from 'lucide-react'
import '@google/model-viewer'
import Header from '../components/layout/Header'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import EmptyState from '../components/ui/EmptyState'
import Spinner from '../components/ui/Spinner'
import { wardrobeService } from '../services/wardrobeService'
import { workMediaService } from '../services/workMediaService'
import { getSessionVersion, onSessionReset } from '../services/sessionLifecycle'
import useWorkMediaPreview from '../hooks/useWorkMediaPreview'
import SourceBadge from '../components/ui/SourceBadge'

// 模拟请求独立展示，不进入已有衣柜；真实历史模型仍可查看、下载和删除。
export default function WardrobePage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const media = useWorkMediaPreview(workMediaService.previewWardrobe)
  const [name, setName] = useState('')
  const [selected, setSelected] = useState(null) // null | 列表项 → 详情态
  const [deleting, setDeleting] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    let alive = true
    const session = getSessionVersion()
    const current = () => alive && session === getSessionVersion()
    wardrobeService.list()
      .then((list) => { if (current()) setItems(list) })
      .catch(() => { if (current()) setLoadError('衣柜列表加载失败，请稍后重试') })
      .finally(() => { if (current()) setLoading(false) })
    const unsubscribe = onSessionReset(() => { setItems([]); setSelected(null); setName(''); setDeleting(false); setLoadError(''); setLoading(false); if (fileInputRef.current) fileInputRef.current.value = '' })
    return () => { alive = false; unsubscribe() }
  }, [])

  const handleFileChange = (event) => {
    media.setFile(event.target.files?.[0] || null)
    event.target.value = ''
  }

  const handleDelete = async () => {
    if (!selected) return
    const session = getSessionVersion()
    try {
      await wardrobeService.remove(selected.id)
      if (session !== getSessionVersion()) return
      setItems(previous => previous.filter(item => item.id !== selected.id))
      setDeleting(false)
      setSelected(null)
    } catch {
      if (session !== getSessionVersion()) return
      setDeleting(false)
      setLoadError('删除失败，请重试')
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-transparent">
      <Header title="3D 衣柜" showBack />
      <main className="flex-1 overflow-y-auto px-4 py-5">
        <section className="rounded-3xl bg-pastel-mist p-5 shadow-card">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-card text-status-info" aria-hidden="true">
              <Box size={22} />
            </div>
            <div>
              <h1 className="text-base font-semibold text-text-primary">3D 衣柜</h1>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                选好单品照片，提交云端接口模拟预览。已有衣物和模型仍可在下方管理。
              </p>
              <p className="mt-2 text-xs leading-relaxed text-text-secondary">提交时原图会发送至应用后端，仅用于本次内存校验，不保存照片，不转发至云端供应商。</p>
            </div>
          </div>
        </section>

        {loadError && <p role="alert" className="mt-3 text-xs text-danger">{loadError}</p>}

        {selected === null ? (
          <>
            <section aria-label="上传单品" className="mt-4 rounded-3xl bg-surface-card p-5 shadow-card">
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择单品照片" className="sr-only" onChange={handleFileChange} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex min-h-20 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border-default bg-surface-page text-sm text-text-secondary transition-colors hover:bg-pastel-mist"
              >
                <ImagePlus size={22} className="text-status-info" aria-hidden="true" />
                {media.file ? `已选：${media.file.name}` : '选择一张单品照片'}
              </button>
              <p className="mt-2 text-xs text-text-muted">PNG、JPEG 或 WebP，最大 8MB</p>
              {media.imageUrl && media.file && <figure className="mt-3"><img src={media.imageUrl} alt={`单品原图：${media.file.name}`} className="max-h-56 w-full rounded-2xl object-contain" /><figcaption className="mt-2 text-center text-xs text-text-secondary">原图 · 尚未生成模型</figcaption></figure>}
              <input
                type="text"
                value={name}
                onChange={event => { media.invalidate(); setName(event.target.value) }}
                maxLength={30}
                aria-label="单品名字"
                placeholder="比如：黑色风衣"
                className="mt-3 min-h-11 w-full rounded-2xl border border-border-default bg-surface-input px-3 text-sm text-text-primary"
              />
              {media.error && <p role="alert" className="mt-2 text-sm text-danger">{media.error}</p>}
              <button
                type="button"
                onClick={() => media.submit(name)}
                disabled={!media.file || media.busy}
                className="mt-3 flex min-h-12 w-full items-center justify-center rounded-2xl bg-action-primary hover:bg-action-hover text-sm font-semibold text-text-inverse shadow-card transition-transform active:scale-95 disabled:opacity-50"
              >
                {media.busy ? '正在模拟预览…' : '提交模拟预览'}
              </button>
              {media.result && <div role="status" aria-label="模拟预览结果" className="mt-3 rounded-2xl bg-pastel-apricot p-4"><SourceBadge source={media.result.source} /><p className="mt-2 text-sm leading-relaxed text-text-primary">{media.result.result.message}</p><p className="mt-2 text-xs text-text-secondary">当前没有可查看或下载的生成模型，衣柜未新增单品。</p></div>}
            </section>

            <section aria-label="衣柜列表" className="mt-4">
              {loading ? (
                <div className="flex justify-center py-8"><Spinner /></div>
              ) : items.length === 0 ? (
                <div className="rounded-3xl bg-surface-card shadow-card">
                  <EmptyState icon={Box} title="衣柜还空着" description="可以在上方体验模拟预览，当前不会新增衣物。" />
                </div>
              ) : (
                <div className="grid gap-3 min-[641px]:grid-cols-2">
                  {items.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelected(item)}
                      className="hover-lift flex items-center gap-4 rounded-3xl bg-surface-card p-4 border border-border-hairline text-left transition-colors hover:bg-pastel-apricot focus:outline-none focus:ring-2 focus:ring-status-info"
                    >
                      <img src={item.sourceUrl} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-2xl object-cover" />
                      <div className="min-w-0 flex-1">
                        <h2 title={item.name} className="truncate text-base font-semibold text-text-primary">{item.name}</h2>
                        <p className="mt-1 text-xs text-text-muted">{format(new Date(item.createdAt), 'yyyy-MM-dd')}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <section aria-label="单品详情" className="mt-4 rounded-3xl bg-surface-card p-5 shadow-card">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="flex min-h-11 items-center gap-1 text-sm font-semibold text-text-secondary"
            >
              <ChevronLeft size={16} aria-hidden="true" />
              返回衣柜
            </button>
            <h2 className="mt-1 text-base font-semibold text-text-primary">{selected.name}</h2>
            <div className="mt-3 overflow-hidden rounded-2xl bg-surface-page">
              <model-viewer src={selected.modelUrl} camera-controls auto-rotate style={{ width: '100%', height: '320px' }} />
            </div>
            <div className="mt-4 flex gap-2">
              <a
                href={selected.modelUrl}
                download
                className="flex min-h-11 flex-1 items-center justify-center rounded-2xl border border-border-default bg-surface-card text-sm font-semibold text-text-secondary"
              >
                下载模型
              </a>
              <button
                type="button"
                onClick={() => setDeleting(true)}
                className="flex min-h-11 flex-1 items-center justify-center rounded-2xl bg-danger text-sm font-semibold text-text-inverse"
              >
                删除
              </button>
            </div>
          </section>
        )}
      </main>

      <ConfirmDialog
        open={deleting}
        title="删除这个单品"
        description={selected ? `「${selected.name}」和它的 3D 模型删除后找不回来了，确定继续吗？` : ''}
        confirmLabel="删除"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleting(false)}
      />
    </div>
  )
}
