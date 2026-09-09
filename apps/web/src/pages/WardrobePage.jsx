import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { Box, ChevronLeft, ImagePlus, ShieldCheck } from 'lucide-react'
import '@google/model-viewer'
import Header from '../components/layout/Header'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { wardrobeService } from '../services/wardrobeService'

// 3D 衣柜：拍一张单品照 → 外部图生 3D → GLB 落库；列表 + <model-viewer> 旋转预览。
// 外部服务未配置时服务端诚实 503，本页原样展示文案，不装成功。
export default function WardrobePage() {
  const [items, setItems] = useState([])
  const [loadError, setLoadError] = useState('')
  const [file, setFile] = useState(null)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [selected, setSelected] = useState(null) // null | 列表项 → 详情态
  const [deleting, setDeleting] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    let alive = true
    wardrobeService.list()
      .then((list) => { if (alive) setItems(list) })
      .catch(() => { if (alive) setLoadError('衣柜列表加载失败，请稍后重试') })
    return () => { alive = false }
  }, [])

  const handleFileChange = (event) => {
    setFile(event.target.files?.[0] || null)
    setCreateError('')
  }

  const handleCreate = async () => {
    if (!file || creating) return
    setCreating(true)
    setCreateError('')
    try {
      const formData = new FormData()
      formData.append('image', file)
      if (name.trim()) formData.append('name', name.trim())
      const created = await wardrobeService.create(formData)
      setItems(previous => [created, ...previous])
      setFile(null)
      setName('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      if (err.response?.data?.code === 'IMAGE_TO_3D_NOT_CONFIGURED') {
        setCreateError(err.response.data.error || '3D 生成服务还没接好，开放后第一时间告诉你')
      } else {
        setCreateError(err.response?.data?.error || '生成失败，请重试')
      }
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    try {
      await wardrobeService.remove(selected.id)
      setItems(previous => previous.filter(item => item.id !== selected.id))
      setDeleting(false)
      setSelected(null)
    } catch {
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
                拍一张单品照，生成可以转着看的 3D 模型收进衣柜。
              </p>
              <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-status-info">
                <ShieldCheck size={12} aria-hidden="true" />
                3D 生成走外部服务，未接好时如实提示
              </span>
            </div>
          </div>
        </section>

        {loadError && <p role="alert" className="mt-3 text-xs text-danger">{loadError}</p>}

        {selected === null ? (
          <>
            <section aria-label="上传单品" className="mt-4 rounded-3xl bg-surface-card p-5 shadow-card">
              <input ref={fileInputRef} type="file" accept="image/*" aria-label="选择单品照片" className="sr-only" onChange={handleFileChange} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex min-h-20 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border-default bg-surface-page text-sm text-text-secondary transition-colors hover:bg-pastel-mist"
              >
                <ImagePlus size={22} className="text-status-info" aria-hidden="true" />
                {file ? `已选：${file.name}` : '选择一张单品照片'}
              </button>
              <input
                type="text"
                value={name}
                onChange={event => setName(event.target.value)}
                maxLength={30}
                aria-label="单品名字"
                placeholder="比如：黑色风衣"
                className="mt-3 min-h-11 w-full rounded-2xl border border-border-default bg-surface-input px-3 text-sm text-text-primary"
              />
              {createError && <p role="alert" className="mt-2 text-xs text-danger">{createError}</p>}
              <button
                type="button"
                onClick={handleCreate}
                disabled={!file || creating}
                className="mt-3 flex min-h-12 w-full items-center justify-center rounded-2xl bg-action-primary hover:bg-action-hover text-sm font-semibold text-text-inverse shadow-card transition-transform active:scale-95 disabled:opacity-50"
              >
                {creating ? '正在生成…' : '生成 3D 模型'}
              </button>
            </section>

            <section aria-label="衣柜列表" className="mt-4">
              {items.length === 0 ? (
                <p className="rounded-3xl bg-surface-card p-5 text-center text-sm text-text-secondary shadow-card">
                  衣柜还空着，传一张单品照试试。
                </p>
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
                        <h2 className="truncate text-base font-semibold text-text-primary">{item.name}</h2>
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
