import Button from '../ui/Button'
import Modal from '../ui/Modal'

/**
 * 放书之后问一句：这本书只放在这台设备上，还是让她聊天时也能翻（路线图 C22）。
 * 两个按钮一样轻重，不替她选；说清楚选了后者书会去哪儿。
 * @param {{ book: { title: string } | null, busy?: boolean, onShare: () => void, onKeepLocal: () => void }} props
 */
export default function ShareBookDialog({ book, busy = false, onShare, onKeepLocal }) {
  return (
    <Modal open={book !== null} title={book ? `《${book.title}》要不要让她也能翻？` : ''}>
      <p className="mt-3 text-left text-sm leading-relaxed text-text-secondary">
        让她翻，她在聊天时会从这本书里找和你说的话相关的一段，放在回你的那一段页边。
      </p>
      <p className="mt-2 text-left text-xs leading-relaxed text-text-muted">
        这样书会存到服务器上，找到的那一段会随聊天发给云端模型。只放在这台设备上的话，只有你读的时候选中一段问她，才会把那一段发过去。之后在书架上随时可以改。
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <Button variant="secondary" disabled={busy} onClick={onKeepLocal}>只放在这台设备</Button>
        <Button variant="secondary" disabled={busy} onClick={onShare}>{busy ? '正在上传…' : '让她聊天时也能翻'}</Button>
      </div>
    </Modal>
  )
}
