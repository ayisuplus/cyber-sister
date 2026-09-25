import { useCallback, useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { memoryService } from '../../services/memoryService'

// 「她猜的」（路线图 C23）：她自己从聊天和你的记忆里整理出来的，没经你确认，不算「她记得的你」。
// 聊天时她当作自己的联想，写信时拿来给你提建议。不对就删掉，她不会再这样猜。
// 没有就不出现；取不到也安静地不出现，不占你的地方。
const KIND_LABELS = { relation: '她觉得这两条有关', insight: '她猜你', followup: '她惦记着' }

const dayLabel = (day) => {
  const [, month, date] = String(day).split('-').map(Number)
  return month && date ? `${month}月${date}日` : ''
}

/**
 * @param {{ refreshKey?: number }} props refreshKey 变了就重新读（你改过、删过记忆后，靠它的猜测可能已经作废）
 */
export default function HerGuesses({ refreshKey = 0 }) {
  const sequence = useRef(0)
  const [items, setItems] = useState([])
  const [busyId, setBusyId] = useState(null)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const request = ++sequence.current
    try {
      const list = await memoryService.listInferences()
      if (request === sequence.current) setItems(Array.isArray(list) ? list : [])
    } catch {
      if (request === sequence.current) setItems([])
    }
  }, [])
  useEffect(() => { load() }, [load, refreshKey])

  const veto = async (item) => {
    setBusyId(item.id); setMessage('')
    try {
      await memoryService.vetoInference(item.id)
      setItems((current) => current.filter((entry) => entry.id !== item.id))
      setMessage('删掉了，她不会再这样猜')
    } catch (error) {
      setMessage(error?.response?.data?.error || '没删掉，请重试')
    } finally { setBusyId(null) }
  }

  if (!items.length && !message) return null

  return <section aria-labelledby="her-guesses-title" className="space-y-3 pt-2">
    <div>
      <h2 id="her-guesses-title" className="text-sm font-semibold text-text-primary">她猜的</h2>
      <p className="mt-1 text-xs leading-relaxed text-text-secondary">她自己从聊天和你的记忆里整理出来的，没经你确认，不算她记得的你。聊天时她只当作自己的联想；不对就删掉，她不会再这样猜。</p>
    </div>
    {message && <p role="status" className="text-xs text-text-secondary">{message}</p>}
    {items.map((item) => <article key={item.id} className="rounded-card border border-dashed border-border-subtle py-2 pl-4 pr-1">
      <div className="flex items-center">
        <p className="text-xs text-text-muted">{KIND_LABELS[item.kind] ?? '她猜你'}{item.kind === 'followup' && item.dueOn ? `，${dayLabel(item.dueOn)}问一句` : ''}</p>
        <button type="button" aria-label={`删掉她的这个猜测：${item.content.slice(0, 12)}`} disabled={busyId === item.id} onClick={() => veto(item)}
          className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center text-text-muted hover:text-danger"><Trash2 size={15} /></button>
      </div>
      <p className="whitespace-pre-wrap pr-3 text-sm leading-relaxed text-text-primary">{item.content}</p>
      {item.because?.length > 0 && <p className="mb-2 mt-2 pr-3 text-xs leading-relaxed text-text-muted">依据：{item.because.map((quote) => `「${quote}」`).join('')}</p>}
    </article>)}
  </section>
}
