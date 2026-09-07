import Button from './Button'
import Modal from './Modal'

// 取消按钮在 DOM 中先于确认按钮：焦点陷阱默认落在取消上，危险操作不会被误触发
export default function ConfirmDialog({ open, title, description, confirmLabel = '确认', cancelLabel = '取消', danger = false, onConfirm, onCancel }) {
  return (
    <Modal open={open} title={title}>
      {description ? <p className="mt-3 text-sm leading-relaxed text-text-secondary">{description}</p> : null}
      <div className="mt-6 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onCancel}>{cancelLabel}</Button>
        <Button variant={danger ? 'danger' : 'primary'} className="flex-1" onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Modal>
  )
}
