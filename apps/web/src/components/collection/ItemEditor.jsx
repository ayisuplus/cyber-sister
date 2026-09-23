import { useRef, useState } from 'react'
import { ImagePlus } from 'lucide-react'
import CollectionPhoto from './CollectionPhoto'
import { SHELVES, STATUS_LABELS } from '../../features/collection/categories'
import { preparePhoto } from '../../features/collection/preparePhoto'
import { sourceOf } from '../../features/collection/shareText'

const chip = (active) => `min-h-11 rounded-full px-3 text-sm transition-colors duration-300 ease-calm ${active ? 'bg-action-primary text-text-inverse' : 'border border-border-subtle bg-surface-card text-text-secondary hover:bg-surface-muted'}`
const inputClass = 'mt-1 min-h-11 w-full rounded-2xl border border-border-default bg-surface-input px-3 text-sm text-text-primary'

function PhotoField({ photos, photoPath, onPick, pickRef }) {
  return (
    <div>
      {photos?.previewUrl
        ? <img src={photos.previewUrl} alt="这件的照片" className="max-h-72 w-full rounded-2xl bg-surface-muted object-contain" />
        : photoPath && <CollectionPhoto path={photoPath} alt="这件的照片" className="max-h-72 w-full rounded-2xl object-contain" />}
      <input ref={pickRef} type="file" accept="image/*" aria-label="给它配一张图" className="sr-only" onChange={(event) => { onPick(event.target.files?.[0]); event.target.value = '' }} />
      <button type="button" onClick={() => pickRef.current?.click()} className="mt-2 flex min-h-11 items-center gap-2 text-sm text-text-secondary">
        <ImagePlus size={16} aria-hidden="true" />{photos?.previewUrl || photoPath ? '换一张图' : '配一张图（比如截图）'}
      </button>
    </div>
  )
}

/**
 * 放进来或改一件：名字、分类、想要/已有、备注；有链接时只读地显示来源。
 * initial.photos 是刚压缩好的新照片；initial.photoPath 是已经存着的那张。
 * @param {{ shelf: 'wardrobe' | 'makeup', initial: any, title: string, onSubmit: (fields: any, photos: any) => Promise<void>, onCancel: () => void }} props
 */
export default function ItemEditor({ shelf, initial, title, onSubmit, onCancel }) {
  const [name, setName] = useState(initial.name ?? '')
  const [category, setCategory] = useState(initial.category ?? '')
  const [status, setStatus] = useState(initial.status ?? 'have')
  const [note, setNote] = useState(initial.note ?? '')
  const [photos, setPhotos] = useState(initial.photos ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pickRef = useRef(null)

  const pick = async (file) => {
    if (!file) return
    try {
      setPhotos(await preparePhoto(file))
      setError('')
    } catch (failure) {
      setError(failure.message)
    }
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!name.trim()) { setError('给它起个名字吧'); return }
    setBusy(true)
    setError('')
    try {
      await onSubmit({ name: name.trim(), category, status, note: note.trim() }, photos)
    } catch (failure) {
      setError(failure.response?.data?.error || '没存上，请重试')
      setBusy(false)
    }
  }

  return (
    <form aria-label={title} onSubmit={submit} className="space-y-4 rounded-card bg-surface-card p-4 shadow-card">
      <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      <PhotoField photos={photos} photoPath={initial.photoPath} onPick={pick} pickRef={pickRef} />
      {initial.link && <p className="break-all text-xs text-text-secondary">来自{sourceOf(initial.link)}的链接</p>}
      <label className="block text-xs text-text-secondary">
        名字
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} className={inputClass} />
      </label>
      <div role="group" aria-label="分类" className="flex flex-wrap gap-2">
        {SHELVES[shelf].categories.map((option) => (
          <button key={option} type="button" aria-pressed={category === option} onClick={() => setCategory(category === option ? '' : option)} className={chip(category === option)}>{option}</button>
        ))}
      </div>
      <div role="group" aria-label="想要还是已有" className="flex gap-2">
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)} className={chip(status === value)}>{label}</button>
        ))}
      </div>
      <label className="block text-xs text-text-secondary">
        备注（色号、尺码、在哪买的……）
        <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} rows={2} className={`${inputClass} py-2`} />
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="min-h-11 flex-1 rounded-2xl border border-border-default bg-surface-card text-sm text-text-secondary">取消</button>
        <button type="submit" disabled={busy} className="min-h-11 flex-1 rounded-2xl bg-action-primary text-sm font-semibold text-text-inverse disabled:opacity-50">{busy ? '正在存…' : '存下来'}</button>
      </div>
    </form>
  )
}
