import { useState } from 'react'
import ConfirmDialog from '../ui/ConfirmDialog'
import { letterService } from '../../services/letterService'

const DECIDED_LABELS = { accepted: '已采纳', dismissed: '没采纳' }
const KIND_LABELS = {
  edit_memory: '想让你改一改',
  delete_memory: '想让你忘掉',
  plan: '想让你安排上',
  // 从她自己整理的关系与理解来的建议（路线图 C23）：你点同意才算数
  merge_memories: '觉得这两条说的是一回事',
  resolve_conflict: '发现这两条对不上',
  promote_inference: '想请你记下这一条',
}
const clip = (text, max = 12) => (text.length > max ? `${text.slice(0, max)}…` : text)

/** 「带去对话」的引导句：优先用她给的 chatText，否则拼一句用户视角的开头。 */
export const composeTextOf = (item) => item.chatText || `你信里说「${item.title}」，`

/** 这一步会删掉哪条：给确认框写清楚。 */
function confirmOf(item, choice) {
  const [a, b] = item.pair ?? []
  if (item.kind === 'delete_memory') return { title: '删掉这条记忆', description: '删掉后不再出现在她记得的你里。', confirmLabel: '删掉' }
  if (item.kind === 'merge_memories') {
    return { title: '合成一条', description: `「${clip(a.content)}」会改成合并后的一句，「${clip(b.content)}」删掉，找不回来。`, confirmLabel: '合成一条' }
  }
  if (choice === 'edit') return { title: '改成一句', description: `「${clip(a.content)}」会改成她建议的说法，「${clip(b.content)}」删掉，找不回来。`, confirmLabel: '就这样改' }
  const [kept, dropped] = choice === 'a' ? [a, b] : [b, a]
  return { title: '留这一条', description: `留下「${clip(kept.content)}」，「${clip(dropped.content)}」删掉，找不回来。`, confirmLabel: '留这一条' }
}

// 要处理的那两条（合并、定夺）：定夺时每条下面「留这条」
function PairList({ pair, onKeep, busy }) {
  return (
    <ol className="mt-2 space-y-2">
      {pair.map((memory, position) => (
        <li key={memory.id} className="border-l-2 border-border-subtle pl-3 text-xs leading-relaxed text-text-secondary">
          <span className="sr-only">{position === 0 ? '第一条：' : '第二条：'}</span>{memory.content}
          {onKeep && (
            <button type="button" disabled={busy} onClick={() => onKeep(position === 0 ? 'a' : 'b')}
              aria-label={`留这条：${clip(memory.content)}`}
              className="ml-2 min-h-11 text-xs font-semibold text-action-primary disabled:opacity-50">留这条</button>
          )}
        </li>
      ))}
    </ol>
  )
}

// 建议里要改成的那一句，按种类说清楚
const PROPOSED_LABELS = { merge_memories: '合成一句', promote_inference: '记成', resolve_conflict: '她建议的说法' }

/** 建议的内容：引文或要处理的两条，以及要改成的那一句 / 想安排的日子。 */
function SuggestionBody({ item, pair, onKeep, busy }) {
  const proposed = PROPOSED_LABELS[item.kind]
  return (
    <>
      {pair && <PairList pair={pair} onKeep={onKeep} busy={busy} />}
      {!pair && item.quote && (
        <blockquote className="mt-2 border-l-2 border-border-subtle pl-3 text-xs leading-relaxed text-text-secondary">
          {item.kind === 'promote_inference' ? `她听你说过：「${item.quote}」` : item.quote}
        </blockquote>
      )}
      {proposed && item.suggestText && <p className="mt-2 text-xs leading-relaxed text-text-primary">{proposed}：{item.suggestText}</p>}
      {item.kind === 'plan' && item.planDate && <p className="mt-2 text-xs text-text-secondary">想安排在 {item.planDate}。</p>}
    </>
  )
}

/** 还没处理时的一排按钮：定夺矛盾没有「同意采纳」，改成「改成她说的」（她给了说法时）和「都对，不用改」。 */
function ActionRow({ item, conflict, busy, onAccept, onEdit, onTakeToChat, onDismiss }) {
  const primary = conflict
    ? item.suggestText && { label: '改成她说的', onClick: onEdit }
    : { label: '同意采纳', onClick: onAccept }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      {primary && (
        <button type="button" disabled={busy} onClick={primary.onClick}
          className="min-h-11 text-xs font-semibold text-action-primary disabled:opacity-50">
          {busy ? '处理中…' : primary.label}
        </button>
      )}
      <button type="button" disabled={busy} onClick={() => onTakeToChat?.(composeTextOf(item))}
        className="min-h-11 text-xs text-text-secondary disabled:opacity-50">带去对话</button>
      <button type="button" disabled={busy} onClick={onDismiss}
        className="min-h-11 text-xs text-text-muted disabled:opacity-50">{conflict ? '都对，不用改' : '不用'}</button>
    </div>
  )
}

const CLOSED_DIALOG = { title: '', description: '', confirmLabel: '确定' }
/** 服务端回来的这一条处理结果；没带就按这次的动作算。 */
const decidedFrom = (result, index, decision) => result?.letter?.suggestions?.[index]?.decided ?? (decision === 'accept' ? 'accepted' : 'dismissed')
const errorText = (requestError) => requestError?.response?.data?.error || '没处理成功，请重试'

// 一条建议的处置区：看信页与聊天里的来信便签共用。一键动作——同意采纳、带去对话、不用。
// 「同意采纳」只在服务端执行（改/删/合并记忆、记下她的理解、建安排）；记忆只能由用户创建和维护，这里只代办你点下的那一次。
/**
 * @param {{ letterId: string, item: object, index: number, onDecided?: (result: object) => void, onTakeToChat?: (text: string) => void }} props
 */
export default function SuggestionActions({ letterId, item, index, onDecided, onTakeToChat }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(null) // null | { choice?: 'a'|'b'|'edit' }
  const [decided, setDecided] = useState(null)

  const decide = async (decision, extra = {}) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await letterService.decide(letterId, index, { decision, ...extra })
      // 就地变成已处理的小字；父级拿到完整结果后爱怎么归档怎么归档
      setDecided(decidedFrom(result, index, decision))
      onDecided?.(result)
    } catch (requestError) {
      setError(errorText(requestError))
    } finally {
      setBusy(false)
    }
  }

  const accept = () => {
    if (item.kind === 'delete_memory' || item.kind === 'merge_memories') setConfirming({})
    else decide('accept')
  }

  const decidedNow = decided ?? item.decided ?? null
  const pair = Array.isArray(item.pair) && item.pair.length === 2 ? item.pair : null
  const conflict = item.kind === 'resolve_conflict' && pair
  const dialog = confirming ? confirmOf(item, confirming.choice) : CLOSED_DIALOG

  return (
    <section aria-label={item.title} className="letter-note mt-4">
      <p className="text-[11px] text-text-muted">{KIND_LABELS[item.kind] ?? '她的一条建议'}</p>
      <h3 className="mt-1 text-sm font-semibold text-text-primary">{item.title}</h3>
      <SuggestionBody item={item} pair={pair} busy={busy}
        onKeep={conflict && decidedNow == null ? (choice) => setConfirming({ choice }) : null} />
      {decidedNow != null
        ? <p className="mt-2 text-xs text-text-muted">{DECIDED_LABELS[decidedNow] ?? '已处理'}</p>
        : <ActionRow item={item} conflict={Boolean(conflict)} busy={busy} onAccept={accept} onEdit={() => setConfirming({ choice: 'edit' })}
          onTakeToChat={onTakeToChat} onDismiss={() => decide('dismiss')} />}
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}

      <ConfirmDialog
        open={Boolean(confirming)}
        title={dialog.title}
        description={dialog.description}
        confirmLabel={dialog.confirmLabel} danger
        busy={busy}
        onConfirm={() => {
          const { choice } = confirming
          setConfirming(null)
          decide('accept', choice ? { keep: choice } : {})
        }}
        onCancel={() => setConfirming(null)}
      />
    </section>
  )
}
