import { useEffect, useState } from 'react'
import { PencilLine } from 'lucide-react'
import { mergeOpeners, pickOpeners } from '../../features/openers'
import { openerService } from '../../services/openerService'

const MAX_OPENERS = 4

// 空白对话的开场区：只放话题。她主动说的话（到点提醒、她来想你、每周的信）落在对话末尾。
// 随口话题一点即发；带笔形图标的敏感话题只填进输入框，输入框已有内容时置灰，不覆盖用户的草稿。
// 先摆本机静态池，再换上她自己线索里的那几条（她惦记的事 / 在读的书 / 最近的手记），
// 每条附一句如实的「为什么看到这条」；接口慢或取不到就安静地留着静态池，不阻塞、不弹错误。
// 手记那条来自你自己写下的字，只填进输入框——发不发由你决定。
export default function Openers({ onSend, onDraft, draftLocked = false }) {
  const [fallback] = useState(() => pickOpeners())
  const [topics, setTopics] = useState(fallback)

  useEffect(() => {
    let active = true
    openerService.listOpeners()
      .then((listed) => {
        if (active) setTopics(mergeOpeners(listed, fallback, MAX_OPENERS))
      })
      .catch(() => {
        // 静态池已经在纸上了：这一屏不因为它晚到或取不到而空着
      })
    return () => { active = false }
  }, [fallback])

  return (
    <div className="w-full">
      <div role="group" aria-label="开场话题" className="flex flex-wrap justify-center gap-2.5">
        {topics.slice(0, MAX_OPENERS).map((topic, index) => (
          <button
            key={topic.id}
            type="button"
            onClick={() => (topic.draft ? onDraft(topic.text) : onSend(topic.text))}
            disabled={Boolean(topic.draft) && draftLocked}
            title={topic.draft ? '填进输入框，改好再发' : undefined}
            style={{ animationDelay: `${400 + index * 80}ms` }}
            className="animate-reveal-up glass-strong inline-flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-full px-5 py-2 text-[13px] text-text-secondary shadow-soft ring-1 ring-border-hairline transition-colors duration-300 ease-calm enabled:hover:bg-pastel-blush enabled:hover:text-action-primary enabled:active:scale-[0.98] disabled:opacity-40"
          >
            <span className="inline-flex items-center gap-1.5">
              {topic.draft && <PencilLine size={13} aria-hidden="true" />}
              {topic.label}
            </span>
            {topic.why && <span className="text-[11px] leading-none text-text-muted">{topic.why}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
