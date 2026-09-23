import { useLetterFontStore } from '../../stores/letterFontStore'

const OPTIONS = [
  { value: 'hand', label: '手写', sample: '今天也辛苦啦', font: 'var(--cs-font-hand)' },
  { value: 'print', label: '印刷', sample: '今天也辛苦啦', font: 'var(--cs-font-print)' },
]

// 信纸上的字：默认手写；读手写吃力时换成清楚的印刷体。信纸、横格、翻页都不变。
export default function LetterFontSetting() {
  const font = useLetterFontStore((state) => state.font)
  const setFont = useLetterFontStore((state) => state.setFont)
  return (
    <fieldset className="mt-4">
      <legend className="text-xs text-text-secondary">信纸上的字</legend>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {OPTIONS.map((option) => (
          <label key={option.value} className={`flex cursor-pointer flex-col items-center gap-1 rounded-control border px-2 py-3 text-xs ${font === option.value ? 'border-action-primary bg-pastel-blush text-text-primary' : 'border-border-default bg-surface-card text-text-secondary'}`}>
            <span aria-hidden="true" className="text-base text-text-primary" style={{ fontFamily: option.font }}>{option.sample}</span>
            <span>{option.label}</span>
            <input type="radio" name="letter-font" value={option.value} checked={font === option.value} onChange={() => setFont(option.value)} aria-label={`信纸上的字：${option.label}`} className="h-4 w-4 accent-action-primary" />
          </label>
        ))}
      </div>
    </fieldset>
  )
}
