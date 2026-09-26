import { useRef, useState } from 'react'
import { ImagePlus } from 'lucide-react'
import CollectionPhoto from '../collection/CollectionPhoto'
import { STATUS_LABELS } from '../../features/garden/labels'
import { preparePhoto } from '../../features/collection/preparePhoto'

const chip = (active) => `min-h-11 rounded-full px-3 text-sm transition-colors duration-300 ease-calm ${active ? 'bg-action-primary text-text-inverse' : 'border border-border-subtle bg-surface-card text-text-secondary hover:bg-surface-muted'}`
const inputClass = 'mt-1 min-h-11 w-full rounded-2xl border border-border-default bg-surface-input px-3 text-sm text-text-primary'

/**
 * 自己写一株，或者改一株：名字、学名、科、路上遇见/我养的、写一句；照片可配可换。不调模型。
 * initial.photos 是刚压缩好的新照片；initial.photoPath 是已经存着的那张。
 * @param {{ initial: any, title: string, onSubmit: (fields: any, photos: any) => Promise<void>, onCancel: () => void }} props
 */
export default function PlantEditor({ initial, title, onSubmit, onCancel }) {
  const [name, setName] = useState(initial.name ?? '')
  const [scientificName, setScientificName] = useState(initial.scientificName ?? '')
  const [family, setFamily] = useState(initial.family ?? '')
  const [status, setStatus] = useState(initial.status ?? 'met')
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
    if (!name.trim()) { setError('给它写个名字吧'); return }
    setBusy(true)
    setError('')
    try {
      await onSubmit({ name: name.trim(), scientificName: scientificName.trim(), family: family.trim(), status, note: note.trim() }, photos)
    } catch (failure) {
      setError(failure.response?.data?.error || '没存上，请重试')
      setBusy(false)
    }
  }

  const hasPhoto = photos?.previewUrl || initial.photoPath
  return (
    <form aria-label={title} onSubmit={submit} className="specimen-sheet space-y-4 rounded-card p-4">
      <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      <div>
        {photos?.previewUrl
          ? <img src={photos.previewUrl} alt="这株的照片" className="specimen-photo mx-auto max-h-64 w-auto object-contain" />
          : initial.photoPath && <CollectionPhoto path={initial.photoPath} alt="这株的照片" className="specimen-photo mx-auto max-h-64 w-auto object-contain" />}
        <input ref={pickRef} type="file" accept="image/*" aria-label="给它配一张照片" className="sr-only" onChange={(event) => { pick(event.target.files?.[0]); event.target.value = '' }} />
        <button type="button" onClick={() => pickRef.current?.click()} className="mt-2 flex min-h-11 items-center gap-2 text-sm text-text-secondary">
          <ImagePlus size={16} aria-hidden="true" />{hasPhoto ? '换一张照片' : '配一张照片'}
        </button>
      </div>
      <label className="block text-xs text-text-secondary">
        名字
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} className={inputClass} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-text-secondary">
          学名（可以不填）
          <input value={scientificName} onChange={(event) => setScientificName(event.target.value)} maxLength={80} lang="la" className={`${inputClass} italic`} />
        </label>
        <label className="block text-xs text-text-secondary">
          科（可以不填）
          <input value={family} onChange={(event) => setFamily(event.target.value)} maxLength={40} className={inputClass} />
        </label>
      </div>
      <div role="group" aria-label="路上遇见还是我养的" className="flex gap-2">
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)} className={chip(status === value)}>{label}</button>
        ))}
      </div>
      <label className="block text-xs text-text-secondary">
        写一句（在哪遇见的、那天的心情……）
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
