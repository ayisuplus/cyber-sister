// 预设横排 + 四个美颜滑杆（磨皮/美白/瘦脸/大眼，0-100）。
// 文案基调：不评价外貌，滑杆标签只描述效果方向，默认档为「自然」。
const SLIDERS = [
  { key: 'smooth', label: '磨皮' },
  { key: 'whiten', label: '美白' },
  { key: 'slim', label: '瘦脸' },
  { key: 'eye', label: '大眼' },
]

export default function SliderPanel({ presets, activePresetId, onSelectPreset, settings, onSettingChange }) {
  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="美颜预设">
        {presets.map(preset => {
          const active = preset.id === activePresetId
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelectPreset(preset)}
              className={`min-h-11 shrink-0 rounded-2xl border px-4 text-sm font-semibold transition-colors ${
                active
                  ? 'border-action-primary bg-pastel-apricot text-action-primary'
                  : 'border-border-default bg-surface-card text-text-secondary'
              }`}
            >
              {preset.name}
            </button>
          )
        })}
      </div>

      <div className="mt-4 space-y-3">
        {SLIDERS.map(slider => (
          <div key={slider.key} className="flex items-center gap-3">
            <label htmlFor={`beauty-slider-${slider.key}`} className="w-10 shrink-0 text-xs font-semibold text-text-secondary">
              {slider.label}
            </label>
            <input
              id={`beauty-slider-${slider.key}`}
              type="range"
              min="0"
              max="100"
              step="1"
              value={settings[slider.key]}
              aria-label={slider.label}
              onChange={event => onSettingChange(slider.key, Number(event.target.value))}
              className="min-h-11 flex-1 accent-action-primary"
            />
            <span className="w-8 shrink-0 text-right text-xs tabular-nums text-text-muted" aria-hidden="true">
              {settings[slider.key]}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
