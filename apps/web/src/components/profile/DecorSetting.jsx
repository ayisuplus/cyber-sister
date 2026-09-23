import { useDecorStore } from '../../stores/decorStore'
import { stickerSrc } from '../letter/Decor'

const OPTIONS = [
  { value: 'on', label: '有' },
  { value: 'off', label: '没有' },
]

// 小装饰：默认有（压花、叶子、火漆印、邮票、日期旁的小画）；喜欢干干净净的可以关掉。
// 样例图不带 .decor，关掉之后在这里也看得到「有」是什么样子。
export default function DecorSetting() {
  const decor = useDecorStore((state) => state.decor)
  const setDecor = useDecorStore((state) => state.setDecor)
  return (
    <fieldset className="mt-4">
      <legend className="text-xs text-text-secondary">小装饰</legend>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {OPTIONS.map((option) => (
          <label key={option.value} className={`flex cursor-pointer flex-col items-center gap-1 rounded-control border px-2 py-3 text-xs ${decor === option.value ? 'border-action-primary bg-pastel-blush text-text-primary' : 'border-border-default bg-surface-card text-text-secondary'}`}>
            <span aria-hidden="true" className="flex h-7 items-center">
              {option.value === 'on'
                ? <img src={stickerSrc('daisy')} alt="" width={28} height={28} />
                : <span className="text-base text-text-muted">——</span>}
            </span>
            <span>{option.label}</span>
            <input type="radio" name="decor" value={option.value} checked={decor === option.value} onChange={() => setDecor(option.value)} aria-label={`小装饰：${option.label}`} className="h-4 w-4 accent-action-primary" />
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-text-muted">压花、火漆印、日期旁的小画，只放在页边，不压字。选择会保存在这台设备上。</p>
    </fieldset>
  )
}
