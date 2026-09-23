import { useCallback, useEffect, useState } from 'react'
import { Brain, Save } from 'lucide-react'
import Spinner from '../ui/Spinner'
import { memoryService } from '../../services/memoryService'
import { parseTags } from '../../utils/parseTags'

const TYPES = ['semantic', 'episodic', 'procedural']

const toCard = (candidate) => ({
  type: TYPES.includes(candidate.type) ? candidate.type : 'semantic',
  content: candidate.content || '',
  importance: Number(candidate.importance) || 5,
  tags: Array.isArray(candidate.tags) ? candidate.tags.join('，') : '',
  saving: false,
  saved: false,
  error: '',
})

// 最新正常回复旁的「帮我记住」入口与候选卡片。
// 候选仅存本组件状态，点「保存」前绝不落库；建议失败只内联提示，不影响聊天。
// autoOpen：你在那一轮说了「帮我记住…」，候选不等你点就摆出来——仍然要你确认才存。
export default function MemorySuggestion({ userMessageId, autoOpen = false }) {
  const [status, setStatus] = useState('idle') // idle | loading | ready | error | empty
  const [cards, setCards] = useState([])

  const fetchSuggestions = useCallback(async () => {
    setStatus('loading')
    setCards([])
    try {
      const data = await memoryService.getSuggestions(userMessageId)
      const candidates = Array.isArray(data?.candidates) ? data.candidates : []
      if (candidates.length === 0) {
        setStatus('empty')
        return
      }
      setCards(candidates.map(toCard))
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [userMessageId])

  // 组件按回复 id 挂载（ChatPage 的 key），所以每条回复最多自动打开一次
  useEffect(() => {
    if (autoOpen) fetchSuggestions()
  }, [autoOpen, fetchSuggestions])

  const updateCard = (index, patch) => {
    setCards((current) => current.map((card, cardIndex) => (cardIndex === index ? { ...card, ...patch } : card)))
  }

  const saveCard = async (index) => {
    const card = cards[index]
    if (!card.content.trim() || card.saving) return
    updateCard(index, { saving: true, error: '' })
    try {
      await memoryService.create({
        type: card.type,
        content: card.content.trim(),
        importance: Number(card.importance),
        tags: parseTags(card.tags),
        origin: 'suggestion',
        sourceRef: userMessageId,
      })
      updateCard(index, { saving: false, saved: true })
    } catch {
      // 保存失败保留候选，可修正后重试
      updateCard(index, { saving: false, error: '保存失败，请重试' })
    }
  }

  const dismissCard = (index) => {
    setCards((current) => current.filter((_, cardIndex) => cardIndex !== index))
  }

  const hasOpenCards = cards.some((card) => !card.saved)
  // 候选全部关闭（保存/忽略）后入口重新出现，再次点击重新拉取而不复用旧候选
  const showEntry = status !== 'loading' && !hasOpenCards

  return (
    <section aria-label="记忆建议" className="space-y-2">
      {showEntry && (
        <button
          type="button"
          onClick={fetchSuggestions}
          className="flex min-h-11 items-center gap-1.5 rounded-full border border-border-subtle bg-surface-card px-4 text-xs text-text-secondary shadow-card transition-colors hover:bg-pastel-blush hover:text-action-primary"
        >
          <Brain size={14} className="text-brand-purple" />
          帮我记住
        </button>
      )}

      {status === 'loading' && (
        <p className="flex items-center gap-2 text-xs text-text-muted">
          <Spinner />
          正在生成记忆建议…
        </p>
      )}

      {status === 'error' && (
        <p role="alert" className="text-xs text-text-muted">暂时无法生成记忆建议，稍后再试</p>
      )}

      {status === 'empty' && (
        <p className="text-xs text-text-muted">这条消息没有值得记住的内容</p>
      )}

      {cards.map((card, index) => (card.saved ? (
        // 保存成功的卡片让位给一句内联确认
        <p key={index} className="text-xs text-status-local">已记住</p>
      ) : (
        <article key={index} className="space-y-3 rounded-card bg-surface-card p-4 shadow-card">
          <div>
            <label htmlFor={`memory-suggestion-content-${index}`} className="mb-1 block text-xs text-text-secondary">记忆内容</label>
            <textarea
              id={`memory-suggestion-content-${index}`}
              value={card.content}
              onChange={(event) => updateCard(index, { content: event.target.value })}
              maxLength={500}
              rows={3}
              className="w-full rounded-xl bg-surface-input p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-status-info"
            />
          </div>
          {card.error && <p role="alert" className="text-xs text-danger">{card.error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => dismissCard(index)}
              className="min-h-11 flex-1 rounded-xl border border-border-subtle text-sm text-text-secondary"
            >
              忽略
            </button>
            <button
              type="button"
              onClick={() => saveCard(index)}
              disabled={card.saving || !card.content.trim()}
              className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-action-primary text-sm font-semibold text-text-inverse hover:bg-action-hover disabled:opacity-50"
            >
              <Save size={15} />
              {card.saving ? '保存中…' : '保存'}
            </button>
          </div>
        </article>
      )))}
    </section>
  )
}
