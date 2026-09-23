import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import SuggestionActions from './SuggestionActions'
import { letterService } from '../../services/letterService'

// 看信：正文按段落走信纸的墨色，每条建议交给 SuggestionActions——同意采纳、带去对话、不用。
/**
 * @param {{ letter: { id: string, content: string, suggestions?: object[] }, onDecided?: (letter: object) => void }} props
 */
export default function LetterView({ letter, onDecided }) {
  const navigate = useNavigate()

  // 换一封看就记下读过（fire-and-forget；失败也不打扰，下次打开还会再记）
  useEffect(() => {
    if (letter?.id) letterService.read(letter.id).catch(() => {})
  }, [letter?.id])

  const suggestions = Array.isArray(letter?.suggestions) ? letter.suggestions : []
  const paragraphs = String(letter?.content ?? '').split(/\n{2,}/).filter(Boolean)

  // 带去对话：拼一句用户视角的话进输入框（已有草稿时不覆盖，交给 ChatPage 处理）
  const takeToChat = (text) => {
    navigate('/chat', { state: { compose: text } })
  }

  return (
    <article aria-label="她的来信" className="letter-entry letter-entry--her">
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="letter-text whitespace-pre-wrap">{paragraph}</p>
      ))}

      {suggestions.map((item, index) => (
        <SuggestionActions
          key={index}
          letterId={letter.id}
          item={item}
          index={index}
          onDecided={(result) => { if (result?.letter) onDecided?.(result.letter) }}
          onTakeToChat={takeToChat}
        />
      ))}

      <div className="mt-4">
        <button type="button" onClick={() => navigate('/chat', { state: { compose: '你信里写的我都看了，' } })}
          className="min-h-11 text-xs text-text-secondary">把这封信带去对话</button>
      </div>
    </article>
  )
}
