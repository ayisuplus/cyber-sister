import { useState } from 'react'
import { chatService } from '../../services/chatService'

// 聊天内确认卡：她提出「改/删你已写下的内容」时，动作摆在这张卡上等你点头。
// 「好，就这么做」才真正执行（服务端凭这条消息 toolRuns 的下标执行同一个动作）；「不用」只把提案标记成没做。
// 视觉沿用「帮我记住」卡片（MemorySuggestion）：圆角卡 + 行内错误 + 原地重试。
/**
 * @param {{ messageId: string, index: number, toolRun: { summary: string }, onDone?: (toolRun: object) => void }} props
 */
export default function ActionConfirmCard({ messageId, index, toolRun, onDone }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(/** @type {null | 'confirmed' | 'dismissed' | 'blocked'} */ (null))
  const [doneSummary, setDoneSummary] = useState('')

  const act = async (action) => {
    if (busy || done) return
    setBusy(true)
    setError('')
    try {
      const result = action === 'confirm'
        ? await chatService.confirmToolAction(messageId, index)
        : await chatService.dismissToolAction(messageId, index)
      setDoneSummary(result.toolRun?.summary || '')
      setDone(action === 'dismiss' ? 'dismissed' : result.toolRun?.ok === false ? 'blocked' : 'confirmed')
      onDone?.(result.toolRun)
    } catch {
      // 保留卡片，可原地重试
      setError('没处理成功，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article aria-label="等你确认" className="rounded-card bg-surface-card p-4 shadow-card">
      {done ? (
        <p className="text-xs text-status-local">{done === 'confirmed' ? doneSummary : done === 'blocked' ? (doneSummary || '操作未完成') : '你没让做'}</p>
      ) : (
        <>
          <p className="text-xs text-text-muted">等你确认</p>
          <p className="mt-1 text-sm text-text-primary">{toolRun.summary}</p>
          {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => act('confirm')}
              className="min-h-11 flex-1 rounded-xl bg-action-primary text-sm font-semibold text-text-inverse disabled:opacity-50"
            >
              {busy ? '处理中…' : '好，就这么做'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => act('dismiss')}
              className="min-h-11 flex-1 rounded-xl border border-border-subtle text-sm text-text-secondary disabled:opacity-50"
            >
              不用
            </button>
          </div>
        </>
      )}
    </article>
  )
}
