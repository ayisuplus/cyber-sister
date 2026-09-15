import Button from './Button'
import Modal from './Modal'

// 取消按钮在 DOM 中先于确认按钮：焦点陷阱默认落在取消上，危险操作不会被误触发
export default function ConfirmDialog({ open, title, description, confirmLabel = '确认', cancelLabel = '取消', danger = false, error = '', busy = false, onConfirm, onCancel }) {
  return (
    <Modal open={open} title={title}>
      {description ? <p className="mt-3 text-sm leading-relaxed text-text-secondary">{description}</p> : null}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-6 flex gap-2">
        <Button variant="secondary" className="flex-1" disabled={busy} onClick={onCancel}>{cancelLabel}</Button>
        <Button variant={danger ? 'danger' : 'primary'} className="flex-1" disabled={busy} onClick={onConfirm}>{busy ? '处理中…' : confirmLabel}</Button>
      </div>
    </Modal>
  )
}
