import { useState } from 'react'
import { ChevronLeft, ExternalLink } from 'lucide-react'
import CollectionPhoto from './CollectionPhoto'
import ConfirmDialog from '../ui/ConfirmDialog'
import { STATUS_LABELS } from '../../features/collection/categories'
import { sourceOf } from '../../features/collection/shareText'

const chip = (active) => `min-h-11 rounded-full px-4 text-sm transition-colors duration-300 ease-calm ${active ? 'bg-action-primary text-text-inverse' : 'border border-border-subtle bg-surface-card text-text-secondary hover:bg-surface-muted'}`
// 只放行 http(s)：存下来的链接原样给你点开，别的协议一律不当链接
const isWebLink = (link) => /^https?:\/\//i.test(String(link ?? ''))

/**
 * 一件收藏：大图、名字、分类、备注、原链接；想要/已有点一下就换；删除先确认。
 * @param {{ item: any, onBack: () => void, onEdit: () => void, onStatus: (status: string) => Promise<void>, onDelete: () => Promise<void> }} props
 */
export default function ItemDetail({ item, onBack, onEdit, onStatus, onDelete }) {
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
    <article aria-label={item.name} className="rounded-card bg-surface-card p-4 shadow-card">
      <button type="button" onClick={onBack} className="flex min-h-11 items-center gap-1 text-sm text-text-secondary">
        <ChevronLeft size={16} aria-hidden="true" />返回
      </button>
      {item.photoUrl && <CollectionPhoto path={item.photoUrl} alt={item.name} className="mt-2 max-h-[60vh] w-full rounded-2xl object-contain" />}
      <h2 className="mt-3 break-words text-base font-semibold text-text-primary">{item.name}</h2>
      {item.category && <p className="mt-1 text-xs text-text-secondary">{item.category}</p>}
      {item.note && <p className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed text-text-primary">{item.note}</p>}
      {isWebLink(item.link) && (
        <a href={item.link} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm text-action-primary">
          打开{sourceOf(item.link)}链接<ExternalLink size={14} aria-hidden="true" />
        </a>
      )}
      <div role="group" aria-label="想要还是已有" className="mt-3 flex gap-2">
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <button key={value} type="button" disabled={busy} aria-pressed={item.status === value} onClick={() => item.status !== value && run(() => onStatus(value), '没改成功，请重试')} className={chip(item.status === value)}>{label}</button>
        ))}
      </div>
      {error && !confirming && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onEdit} className="min-h-11 flex-1 rounded-2xl border border-border-default bg-surface-card text-sm text-text-secondary">编辑</button>
        <button type="button" onClick={() => { setError(''); setConfirming(true) }} className="min-h-11 flex-1 rounded-2xl border border-border-default bg-surface-card text-sm text-danger">删除</button>
      </div>
      <ConfirmDialog
        open={confirming}
        title="删掉这一件"
        description={`「${item.name}」和它的照片删掉后找不回来了。`}
        confirmLabel="删掉" danger busy={busy} error={error}
        onConfirm={() => run(onDelete, '没删掉，请重试')}
        onCancel={() => { setConfirming(false); setError('') }}
      />
    </article>
  )
}
