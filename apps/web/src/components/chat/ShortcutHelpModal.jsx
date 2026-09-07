import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { SHORTCUTS } from '../../hooks/useGlobalShortcuts'

// 快捷键帮助弹层：遵守 Modal 按钮关闭约定，底部「知道了」为唯一关闭入口（Esc 由全局 hook 承担）
export default function ShortcutHelpModal({ open, onClose }) {
  return (
    <Modal open={open} title="键盘快捷键">
      <ul className="mt-4 space-y-2 text-left text-sm text-text-secondary">
        {SHORTCUTS.map(({ keys, label }) => (
          <li key={keys} className="flex items-center justify-between gap-3">
            <span>{label}</span>
            <kbd className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-xs text-text-primary">{keys}</kbd>
          </li>
        ))}
      </ul>
      <Button className="mt-5 w-full" onClick={onClose}>知道了</Button>
    </Modal>
  )
}
