import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import CollectionPhoto from '../collection/CollectionPhoto'
import ConfirmDialog from '../ui/ConfirmDialog'
import { PlantCaution, PlantExplanation } from './PlantNotes'
import { dayLabel, HONEST_NOTE, STATUS_LABELS } from '../../features/garden/labels'

const chip = (active) => `min-h-11 rounded-full px-4 text-sm transition-colors duration-300 ease-calm ${active ? 'bg-action-primary text-text-inverse' : 'border border-border-subtle bg-surface-card text-text-secondary hover:bg-surface-muted'}`

/**
 * 图鉴里的一株：照片、手写的名字、学名与科、哪天收的、要小心的地方、她的讲解、你写的那句。
 * 路上遇见/我养的点一下就换；拿掉先确认。
 * @param {{ entry: any, onBack: () => void, onEdit: () => void, onStatus: (status: string) => Promise<void>, onDelete: () => Promise<void> }} props
 */
export default function PlantDetail({ entry, onBack, onEdit, onStatus, onDelete }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (task, fallback) => {
    setBusy(true)
    setError('')
    try {
      await task()
    } catch (failure) {
      setError(failure.response?.data?.error || fallback)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article aria-label={entry.name} className="specimen-sheet rounded-card p-4">
      <button type="button" onClick={onBack} className="flex min-h-11 items-center gap-1 text-sm text-text-secondary">
        <ChevronLeft size={16} aria-hidden="true" />回到图鉴
      </button>
      {entry.photoUrl && <CollectionPhoto path={entry.photoUrl} alt={entry.name} className="specimen-photo mx-auto mt-2 max-h-[55vh] w-auto object-contain" />}
      <div className="specimen-label mt-4">
        <h2 className="break-words font-hand text-2xl text-text-primary">{entry.name}</h2>
        {entry.scientificName && <p className="mt-0.5 text-sm italic text-text-secondary" lang="la">{entry.scientificName}</p>}
        <p className="mt-1 text-xs text-text-secondary">{[entry.family, `${dayLabel(entry.createdAt)}收进来`].filter(Boolean).join(' · ')}</p>
      </div>
      <PlantCaution caution={entry.caution} />
      <PlantExplanation explanation={entry.explanation} />
      {entry.identified && <p className="mt-2 text-xs text-text-muted">{HONEST_NOTE}</p>}
      {entry.note && <p className="mt-3 whitespace-pre-line break-words font-hand text-[15px] leading-relaxed text-text-primary">{entry.note}</p>}
      <div role="group" aria-label="路上遇见还是我养的" className="mt-4 flex gap-2">
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <button key={value} type="button" disabled={busy} aria-pressed={entry.status === value} onClick={() => entry.status !== value && run(() => onStatus(value), '没改成功，请重试')} className={chip(entry.status === value)}>{label}</button>
        ))}
      </div>
      {error && !confirming && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onEdit} className="min-h-11 flex-1 rounded-2xl border border-border-default bg-surface-card text-sm text-text-secondary">编辑</button>
        <button type="button" onClick={() => { setError(''); setConfirming(true) }} className="min-h-11 flex-1 rounded-2xl border border-border-default bg-surface-card text-sm text-danger">从图鉴拿掉</button>
      </div>
      <ConfirmDialog
        open={confirming}
        title="从图鉴里拿掉"
        description={`「${entry.name}」和它的照片拿掉后找不回来了。`}
        confirmLabel="拿掉" danger busy={busy} error={error}
        onConfirm={() => run(onDelete, '没拿掉，请重试')}
        onCancel={() => { setConfirming(false); setError('') }}
      />
    </article>
  )
}
