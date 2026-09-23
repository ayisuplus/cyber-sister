import { useState } from 'react'
import ConfirmDialog from '../ui/ConfirmDialog'
import { letterService } from '../../services/letterService'

const DECIDED_LABELS = { accepted: '已采纳', dismissed: '没采纳' }
const KIND_LABELS = { edit_memory: '想让你改一改', delete_memory: '想让你忘掉', plan: '想让你安排上' }

/** 「带去对话」的引导句：优先用她给的 chatText，否则拼一句用户视角的开头。 */
export const composeTextOf = (item) => item.chatText || `你信里说「${item.title}」，`

// 一条建议的处置区：看信页与聊天里的来信便签共用。三个一键动作——同意采纳、带去对话、不用。
// 「同意采纳」只在服务端执行（改/删记忆、建安排）；记忆只能由用户创建和维护，这里只代办你点下的那一次。
/**
 * @param {{ letterId: string, item: object, index: number, onDecided?: (result: object) => void, onTakeToChat?: (text: string) => void }} props
 */
export default function SuggestionActions({ letterId, item, index, onDecided, onTakeToChat }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [decided, setDecided] = useState(null)

  const decide = async (decision) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await letterService.decide(letterId, index, { decision })
      // 就地变成已处理的小字；父级拿到完整结果后爱怎么归档怎么归档
      setDecided(result?.letter?.suggestions?.[index]?.decided ?? (decision === 'accept' ? 'accepted' : 'dismissed'))
      onDecided?.(result)
    } catch (requestError) {
      setError(requestError?.response?.data?.error || '没处理成功，请重试')
    } finally {
      setBusy(false)
    }
  }

  const accept = () => {
    if (item.kind === 'delete_memory') setConfirming(true)
    else decide('accept')
  }

  const decidedNow = decided ?? item.decided ?? null

  return (
    <section aria-label={item.title} className="letter-note mt-4">
      <p className="text-[11px] text-text-muted">{KIND_LABELS[item.kind] ?? '她的一条建议'}</p>
      <h3 className="mt-1 text-sm font-semibold text-text-primary">{item.title}</h3>
      {item.quote && (
        <blockquote className="mt-2 border-l-2 border-border-subtle pl-3 text-xs leading-relaxed text-text-secondary">
          {item.quote}
        </blockquote>
      )}
      {item.kind === 'plan' && item.planDate && (
        <p className="mt-2 text-xs text-text-secondary">想安排在 {item.planDate}。</p>
      )}
      {decidedNow != null
        ? <p className="mt-2 text-xs text-text-muted">{DECIDED_LABELS[decidedNow] ?? '已处理'}</p>
        : (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy} onClick={accept}
              className="min-h-11 text-xs font-semibold text-action-primary disabled:opacity-50">
              {busy ? '处理中…' : '同意采纳'}
            </button>
            <button type="button" disabled={busy} onClick={() => onTakeToChat?.(composeTextOf(item))}
              className="min-h-11 text-xs text-text-secondary disabled:opacity-50">带去对话</button>
            <button type="button" disabled={busy} onClick={() => decide('dismiss')}
              className="min-h-11 text-xs text-text-muted disabled:opacity-50">不用</button>
          </div>
        )}
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}

      <ConfirmDialog
        open={confirming}
        title="删掉这条记忆"
        description="删掉后不再出现在她记得的你里。"
        confirmLabel="删掉" danger
        busy={busy}
        onConfirm={() => {
          setConfirming(false)
          decide('accept')
        }}
        onCancel={() => setConfirming(false)}
      />
    </section>
  )
}
