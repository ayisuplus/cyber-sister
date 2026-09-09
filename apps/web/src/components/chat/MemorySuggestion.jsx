import { useState } from 'react'
import { Brain, Save } from 'lucide-react'
import Spinner from '../ui/Spinner'
import { memoryService } from '../../services/memoryService'
import { parseTags } from '../../utils/parseTags'

const TYPE_OPTIONS = [
  { value: 'semantic', label: '语义记忆' },
  { value: 'episodic', label: '情景记忆' },
  { value: 'procedural', label: '程序记忆' },
]

const toCard = (candidate) => ({
  type: TYPE_OPTIONS.some((option) => option.value === candidate.type) ? candidate.type : 'semantic',
  content: candidate.content || '',
  importance: Number(candidate.importance) || 5,
  tags: Array.isArray(candidate.tags) ? candidate.tags.join('，') : '',
  saving: false,
  saved: false,
  error: '',
})

// 最新正常回复旁的「帮我记住」入口与候选卡片。
// 候选仅存本组件状态，点「保存」前绝不落库；建议失败只内联提示，不影响聊天。
export default function MemorySuggestion({ userMessageId }) {
  const [status, setStatus] = useState('idle') // idle | loading | ready | error | empty
  const [cards, setCards] = useState([])

  const fetchSuggestions = async () => {
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
  }

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
              className="w-full rounded-xl bg-surface-input p-3 text-sm outline-none focus:ring-2 focus:ring-brand-pink/30"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`memory-suggestion-type-${index}`} className="mb-1 block text-xs text-text-secondary">类型</label>
              <select
                id={`memory-suggestion-type-${index}`}
                value={card.type}
                onChange={(event) => updateCard(index, { type: event.target.value })}
                className="min-h-11 w-full rounded-xl bg-surface-input px-3 text-sm"
              >
                {TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`memory-suggestion-importance-${index}`} className="mb-1 block text-xs text-text-secondary">重要度（1–10）</label>
              <input
                id={`memory-suggestion-importance-${index}`}
                type="number"
                min="1"
                max="10"
                value={card.importance}
                onChange={(event) => updateCard(index, { importance: Number(event.target.value) })}
                className="min-h-11 w-full rounded-xl bg-surface-input px-3 text-sm"
              />
            </div>
          </div>
          <div>
            <label htmlFor={`memory-suggestion-tags-${index}`} className="mb-1 block text-xs text-text-secondary">标签（逗号分隔）</label>
            <input
              id={`memory-suggestion-tags-${index}`}
              value={card.tags}
              onChange={(event) => updateCard(index, { tags: event.target.value })}
              className="min-h-11 w-full rounded-xl bg-surface-input px-3 text-sm"
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
