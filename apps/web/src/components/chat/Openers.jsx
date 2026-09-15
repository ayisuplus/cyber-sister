import { useState } from 'react'
import { PencilLine } from 'lucide-react'
import CareCards from '../care/CareCards'
import { pickOpeners } from '../../features/openers'

const MAX_OPENERS = 4
const MAX_CARE = 2

// 空白对话的开场区：话题 + 她的关怀，合计不超过 4 个，关怀优先占位。
// 随口话题一点即发；带笔形图标的敏感话题只填进输入框，输入框已有内容时置灰，不覆盖用户的草稿。
export default function Openers({ onSend, onDraft, draftLocked = false, withCare = false }) {
  const [careCount, setCareCount] = useState(0)
  const [topics] = useState(() => pickOpeners())
  const visible = topics.slice(0, MAX_OPENERS - Math.min(careCount, MAX_CARE))

  return (
    <div className="w-full">
      <div role="group" aria-label="开场话题" className="flex flex-wrap justify-center gap-2.5">
        {visible.map((topic, index) => (
          <button
            key={topic.id}
            type="button"
            onClick={() => (topic.draft ? onDraft(topic.text) : onSend(topic.text))}
            disabled={Boolean(topic.draft) && draftLocked}
            title={topic.draft ? '填进输入框，改好再发' : undefined}
            style={{ animationDelay: `${400 + index * 80}ms` }}
            className="animate-reveal-up glass-strong inline-flex min-h-11 items-center gap-1.5 rounded-full px-5 py-2 text-[13px] text-text-secondary shadow-soft ring-1 ring-border-hairline transition-colors duration-300 ease-calm enabled:hover:bg-pastel-blush enabled:hover:text-action-primary enabled:active:scale-[0.98] disabled:opacity-40"
          >
            {topic.draft && <PencilLine size={13} aria-hidden="true" />}
            {topic.label}
          </button>
        ))}
      </div>
      {withCare && (
        <div className="mx-auto mt-6 w-full max-w-sm">
          <CareCards limit={MAX_CARE} heading={false} onCount={setCareCount} />
        </div>
      )}
    </div>
  )
}
