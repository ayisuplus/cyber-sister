import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, ImagePlus, Link2, Plus } from 'lucide-react'
import CameraCapture from './CameraCapture'
import CollectionPhoto from './CollectionPhoto'
import ItemDetail from './ItemDetail'
import ItemEditor from './ItemEditor'
import { collectionService } from '../../services/collectionService'
import { getSessionVersion, onSessionReset } from '../../services/sessionLifecycle'
import { SHELVES, STATUS_LABELS } from '../../features/collection/categories'
import { preparePhoto } from '../../features/collection/preparePhoto'
import { parseShareText, sourceOf } from '../../features/collection/shareText'

const chip = (active) => `min-h-11 shrink-0 rounded-full px-3 text-sm transition-colors duration-300 ease-calm ${active ? 'bg-action-primary text-text-inverse' : 'border border-border-subtle bg-surface-card text-text-secondary hover:bg-surface-muted'}`
const choiceClass = 'flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl border border-border-default bg-surface-card px-2 text-sm text-text-secondary hover:bg-surface-muted'
/** @typedef {{ kind: 'browse' | 'camera' | 'paste' | 'edit' | 'detail', id?: string, initial?: any }} ShelfView */

// 手机、平板上直接交给系统相机；电脑上在页面里开摄像头
const prefersSystemCamera = () => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches

/** 顶上一行「全部 / 想要 / 已有」，下面是用过的分类；都只在有东西时出现。 */
function ShelfFilters({ items, status, category, onStatus, onCategory }) {
  const used = [...new Set(items.map((item) => item.category).filter(Boolean))]
  return (
    <div className="space-y-2">
      <div role="group" aria-label="想要还是已有" className="flex gap-2">
        {[['all', '全部'], ...Object.entries(STATUS_LABELS)].map(([value, label]) => (
          <button key={value} type="button" aria-pressed={status === value} onClick={() => onStatus(value)} className={chip(status === value)}>{label}</button>
        ))}
      </div>
      {used.length > 0 && (
        <div role="group" aria-label="分类" className="flex gap-2 overflow-x-auto pb-1">
          {used.map((option) => (
            <button key={option} type="button" aria-pressed={category === option} onClick={() => onCategory(category === option ? null : option)} className={chip(category === option)}>{option}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function ShelfTile({ item, onOpen }) {
  return (
    <li>
      <button type="button" onClick={onOpen} aria-label={item.status === 'want' ? `${item.name}，想要` : item.name} className="block w-full text-left">
        <span className="relative block aspect-square overflow-hidden rounded-2xl bg-surface-muted">
          {item.thumbUrl
            ? <CollectionPhoto path={item.thumbUrl} className="h-full w-full object-cover" />
            : (
              <span className="flex h-full flex-col justify-between bg-pastel-blush p-3">
                <span className="line-clamp-4 break-words text-sm text-text-primary">{item.name}</span>
                {item.link && <span className="text-[11px] text-text-secondary">{sourceOf(item.link)}</span>}
              </span>
            )}
          {item.status === 'want' && <span aria-hidden="true" className="absolute bottom-2 right-2 rounded-full bg-surface-card px-2 py-0.5 text-[10px] text-text-secondary">想要</span>}
        </span>
        {item.thumbUrl && <span aria-hidden="true" className="mt-1.5 block truncate text-xs text-text-secondary">{item.name}</span>}
      </button>
    </li>
  )
}

function PastePanel({ onNext, onCancel }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const next = () => {
    const parsed = parseShareText(text)
    if (!parsed.link) { setError('没找到链接。把分享出来的整段文字贴进来试试。'); return }
    onNext(parsed)
  }
  return (
    <section aria-label="粘贴链接" className="rounded-card bg-surface-card p-4 shadow-card">
      <label className="block text-xs text-text-secondary">
        把分享的文字或链接粘贴到这里
        <textarea value={text} onChange={(event) => { setText(event.target.value); setError('') }} rows={3} className="mt-1 w-full rounded-2xl border border-border-default bg-surface-input px-3 py-2 text-sm text-text-primary" />
      </label>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onCancel} className="min-h-11 flex-1 rounded-2xl border border-border-default bg-surface-card text-sm text-text-secondary">取消</button>
        <button type="button" onClick={next} disabled={!text.trim()} className="min-h-11 flex-1 rounded-2xl bg-action-primary text-sm font-semibold text-text-inverse disabled:opacity-50">下一步</button>
      </div>
    </section>
  )
}

/** 翻看这一柜：放进来的三个入口、筛选、照片网格；空的时候说一句怎么放。 */
function ShelfBrowse({ shelf, items, visible, loading, error, status, category, onStatus, onCategory, adding, onToggleAdding, onTakePhoto, onPickAlbum, onPaste, onOpen, pickers }) {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      {pickers}
      <div className="flex justify-end">
        <button type="button" aria-expanded={adding} onClick={onToggleAdding} className="flex min-h-11 items-center gap-1.5 rounded-full bg-action-primary px-4 text-sm font-semibold text-text-inverse">
          <Plus size={16} aria-hidden="true" />放进来
        </button>
      </div>
      {adding && (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onTakePhoto} className={choiceClass}><Camera size={16} aria-hidden="true" />拍一张</button>
          <button type="button" onClick={onPickAlbum} className={choiceClass}><ImagePlus size={16} aria-hidden="true" />从相册选</button>
          <button type="button" onClick={onPaste} className={choiceClass}><Link2 size={16} aria-hidden="true" />粘贴链接</button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      {loading && <p role="status" className="mt-6 text-center text-sm text-text-muted">正在打开…</p>}
      {!loading && !error && items.length === 0 && <p className="mt-10 px-6 text-center text-sm leading-relaxed text-text-secondary">{SHELVES[shelf].empty}</p>}
      {items.length > 0 && (
        <div className="mt-3">
          <ShelfFilters items={items} status={status} category={category} onStatus={onStatus} onCategory={onCategory} />
          <ul aria-label={SHELVES[shelf].label} className="mt-3 grid grid-cols-2 gap-3 pb-6 min-[641px]:grid-cols-3 min-[1024px]:grid-cols-4">
            {visible.map((item) => <ShelfTile key={item.id} item={item} onOpen={() => onOpen(item.id)} />)}
          </ul>
          {visible.length === 0 && <p className="text-center text-sm text-text-secondary">这里还没有。</p>}
        </div>
      )}
    </div>
  )
}

function useShelfItems(shelf) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    let alive = true
    const session = getSessionVersion()
    const current = () => alive && session === getSessionVersion()
    collectionService.list(shelf)
      .then((list) => { if (current()) setItems(list ?? []) })
      .catch(() => { if (current()) setLoadError('收藏没读出来，请稍后再试。') })
      .finally(() => { if (current()) setLoading(false) })
    // 退出登录时清空，不把上一个人的收藏留在页面上
    const unsubscribe = onSessionReset(() => { setItems([]); setLoadError('') })
    return () => { alive = false; unsubscribe() }
  }, [shelf])
  return { items, setItems, loading, loadError }
}

/**
 * 「装扮」里的一个柜子（衣柜或化妆间）：翻看、筛选、放进来、看一件、改一件。
 * @param {{ shelf: 'wardrobe' | 'makeup' }} props
 */
export default function CollectionShelf({ shelf }) {
  const { items, setItems, loading, loadError } = useShelfItems(shelf)
  const [status, setStatus] = useState('all')
  const [category, setCategory] = useState(null)
  const [view, setView] = useState(/** @type {ShelfView} */ ({ kind: 'browse' }))
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const albumRef = useRef(null)
  const cameraRef = useRef(null)

  const visible = useMemo(() => items.filter((item) => (status === 'all' || item.status === status) && (!category || item.category === category)), [items, status, category])
  const detail = view.kind === 'detail' ? items.find((item) => item.id === view.id) : null

  const withPhoto = async (file) => {
    if (!file) return
    setError('')
    try {
      setView({ kind: 'edit', initial: { status: 'have', photos: await preparePhoto(file) } })
      setAdding(false)
    } catch (failure) {
      setView({ kind: 'browse' })
      setError(failure.message)
    }
  }

  const takePhoto = () => {
    if (prefersSystemCamera()) cameraRef.current?.click()
    else setView({ kind: 'camera' })
  }

  const save = async (fields, photos) => {
    if (view.id) {
      const saved = await collectionService.update(view.id, fields, photos)
      setItems((list) => list.map((item) => (item.id === saved.id ? saved : item)))
      setView({ kind: 'detail', id: saved.id })
      return
    }
    const saved = await collectionService.create({ shelf, link: view.initial.link, ...fields }, photos)
    setItems((list) => [saved, ...list])
    setView({ kind: 'browse' })
  }

  const changeStatus = async (next) => {
    const saved = await collectionService.update(detail.id, { status: next })
    setItems((list) => list.map((item) => (item.id === saved.id ? saved : item)))
  }

  const remove = async () => {
    await collectionService.remove(detail.id)
    setItems((list) => list.filter((item) => item.id !== detail.id))
    setView({ kind: 'browse' })
  }

  const pickers = (
    <>
      <input ref={albumRef} type="file" accept="image/*" aria-label="从相册选一张" className="sr-only" onChange={(event) => { withPhoto(event.target.files?.[0]); event.target.value = '' }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" aria-label="拍一张（打开相机）" className="sr-only" onChange={(event) => { withPhoto(event.target.files?.[0]); event.target.value = '' }} />
    </>
  )

  if (view.kind === 'camera') {
    return <div className="flex-1 overflow-y-auto px-4 py-4">{pickers}<CameraCapture onCapture={withPhoto} onCancel={() => setView({ kind: 'browse' })} onFallback={() => { setView({ kind: 'browse' }); albumRef.current?.click() }} /></div>
  }
  if (view.kind === 'paste') {
    return <div className="flex-1 overflow-y-auto px-4 py-4"><PastePanel onCancel={() => setView({ kind: 'browse' })} onNext={(parsed) => { setAdding(false); setView({ kind: 'edit', initial: { name: parsed.name, link: parsed.link, status: 'want' } }) }} /></div>
  }
  if (view.kind === 'edit') {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <ItemEditor shelf={shelf} initial={view.initial} title={view.id ? '改一改' : `放进${SHELVES[shelf].label}`} onSubmit={save} onCancel={() => setView(view.id ? { kind: 'detail', id: view.id } : { kind: 'browse' })} />
      </div>
    )
  }
  if (detail) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <ItemDetail
          item={detail}
          onBack={() => setView({ kind: 'browse' })}
          onEdit={() => setView({ kind: 'edit', id: detail.id, initial: { ...detail, photoPath: detail.photoUrl } })}
          onStatus={changeStatus}
          onDelete={remove}
        />
      </div>
    )
  }

  return (
    <ShelfBrowse
      shelf={shelf} items={items} visible={visible} loading={loading} error={error || loadError}
      status={status} category={category} onStatus={setStatus} onCategory={setCategory}
      adding={adding} onToggleAdding={() => setAdding((open) => !open)}
      onTakePhoto={takePhoto} onPickAlbum={() => albumRef.current?.click()} onPaste={() => setView({ kind: 'paste' })}
      onOpen={(id) => setView({ kind: 'detail', id })}
      pickers={pickers}
    />
  )
}
