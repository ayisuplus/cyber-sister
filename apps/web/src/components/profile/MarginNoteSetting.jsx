import { useMarginNoteStore } from '../../stores/marginNoteStore'

const OPTIONS = [
  { value: 'on', label: '有' },
  { value: 'off', label: '没有' },
]

// 页边批注：她写这一段时翻过哪本书，用铅笔小字写在页边；默认有，不想看可以关掉（路线图 C21）。
export default function MarginNoteSetting() {
  const marginNotes = useMarginNoteStore((state) => state.marginNotes)
  const setMarginNotes = useMarginNoteStore((state) => state.setMarginNotes)
  return (
    <fieldset className="mt-4">
      <legend className="text-xs text-text-secondary">页边批注</legend>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {OPTIONS.map((option) => (
          <label key={option.value} className={`flex cursor-pointer flex-col items-center gap-1 rounded-control border px-2 py-3 text-xs ${marginNotes === option.value ? 'border-action-primary bg-pastel-blush text-text-primary' : 'border-border-default bg-surface-card text-text-secondary'}`}>
            <span aria-hidden="true" className="flex h-7 items-center text-text-muted">
              {option.value === 'on' ? '翻过的书 · 《…》' : '——'}
            </span>
            <span>{option.label}</span>
            <input type="radio" name="margin-notes" value={option.value} checked={marginNotes === option.value} onChange={() => setMarginNotes(option.value)} aria-label={`页边批注：${option.label}`} className="h-4 w-4 accent-action-primary" />
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-text-muted">她回你时翻过哪本书的哪一章，用铅笔小字写在那一段下面，点开能看到出处和边界。选择会保存在这台设备上。</p>
    </fieldset>
  )
}
