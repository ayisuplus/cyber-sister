import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import SuggestionActions from '../letter/SuggestionActions'
import { nudgeService } from '../../services/nudgeService'

const POLL_INTERVAL_MS = 60_000

// 她主动说的话都落在信纸末尾，像夹在这一页里的便签：到点的安排、她来想你、惦记的事、每周的信。
// 每条都附一句「为什么看到这条」，「知道了」当场收起；取不到就安静地什么都不显示，绝不用假数据占位。
// 来信便签里的建议就地处置（同意采纳/带去对话/不用），与看信页同一套动作；onComposeDraft 是聊天输入框的交接通道。
/**
 * @param {{ onComposeDraft?: (text: string) => void }} props
 */
export default function HerNudges({ onComposeDraft }) {
  const navigate = useNavigate()
  const [nudges, setNudges] = useState([])

  const load = useCallback(async () => {
    try {
      const data = await nudgeService.list()
      setNudges(Array.isArray(data?.nudges) ? data.nudges : [])
    } catch {
      // 对话本身不受影响；下一次轮询再试
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load() }, POLL_INTERVAL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const dismiss = (id) => {
    // 乐观收起；失败不打扰——条件仍成立时下次打开还会出现
    setNudges((current) => current.filter((nudge) => nudge.id !== id))
    nudgeService.ack(id).catch(() => {})
  }

  // 「带去对话」：优先交给聊天输入框（已有草稿时不覆盖）；没有交接通道就走去 /chat 的一次性路由状态
  const takeToChat = (text) => {
    if (onComposeDraft) onComposeDraft(text)
    else navigate('/chat', { state: { compose: text } })
  }

  if (nudges.length === 0) return null

  return (
    <section aria-label="她想对你说" className="space-y-3">
      {nudges.map((nudge) => (
        <article key={nudge.id} className="letter-note">
          <p className="whitespace-pre-line text-[15px] leading-relaxed text-text-primary">{nudge.content}</p>
          {nudge.kind === 'letter' && (Array.isArray(nudge.suggestions) ? nudge.suggestions : []).map((item, index) => (
            <SuggestionActions key={index} letterId={nudge.letterId} item={item} index={index} onTakeToChat={takeToChat} />
          ))}
          {nudge.detail && <p className="mt-2 whitespace-pre-line rounded-2xl bg-surface-muted p-3 text-xs leading-relaxed text-text-secondary">{nudge.detail}</p>}
          <p className="mt-2 text-[11px] text-text-muted">为什么看到这条：{nudge.reason}</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => dismiss(nudge.id)} className="min-h-11 text-xs font-semibold text-action-primary">知道了</button>
            {nudge.action?.to && (
              <Link to={nudge.action.to} className="min-h-11 text-xs text-text-secondary">{nudge.action.label} →</Link>
            )}
          </div>
        </article>
      ))}
    </section>
  )
}
