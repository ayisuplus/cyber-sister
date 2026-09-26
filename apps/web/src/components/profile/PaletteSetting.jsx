import { CUSTOM_PALETTE, HUE_TRACK, PALETTES, swatchOf } from '../../features/palette'
import { usePaletteStore } from '../../stores/paletteStore'

/** 浅色圆底 + 中间一颗主色圆点 */
function Swatch({ choice, size = 'h-7 w-7' }) {
  const { soft, strong } = swatchOf(choice)
  return (
    <span aria-hidden="true" className={`flex ${size} items-center justify-center rounded-full border border-border-subtle`} style={{ background: soft }}>
      <span className="h-3 w-3 rounded-full" style={{ background: strong }} />
    </span>
  )
}

const optionClass = (active) => `flex cursor-pointer flex-col items-center gap-1.5 rounded-control border px-1 py-3 text-xs ${active
  ? 'border-action-primary bg-pastel-blush text-text-primary'
  : 'border-border-default bg-surface-card text-text-secondary'}`

// 主题色（路线图 C25）：六套预设，或者自己拖一个色相。选了立刻整页换色；对比度由生成规则保证。
export default function PaletteSetting() {
  const choice = usePaletteStore((state) => state.choice)
  const setChoice = usePaletteStore((state) => state.setChoice)
  const custom = choice.id === CUSTOM_PALETTE

  return (
    <fieldset className="mt-4">
      <legend className="text-xs text-text-secondary">主题色</legend>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {PALETTES.map((palette) => (
          <label key={palette.id} className={optionClass(choice.id === palette.id)}>
            <Swatch choice={{ id: palette.id }} />
            <span>{palette.name}</span>
            <input
              type="radio"
              name="palette"
              value={palette.id}
              checked={choice.id === palette.id}
              onChange={() => setChoice({ id: palette.id })}
              aria-label={`主题色：${palette.name}`}
              className="h-4 w-4 accent-action-primary"
            />
          </label>
        ))}
      </div>

      <div className={`mt-2 rounded-control border px-3 py-3 ${custom ? 'border-action-primary bg-pastel-blush' : 'border-border-default bg-surface-card'}`}>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-text-secondary">
          <input
            type="radio"
            name="palette"
            value={CUSTOM_PALETTE}
            checked={custom}
            onChange={() => setChoice({ id: CUSTOM_PALETTE, hue: choice.hue })}
            aria-label="主题色：自己调"
            className="h-4 w-4 accent-action-primary"
          />
          <span className={custom ? 'text-text-primary' : undefined}>自己调</span>
          <span className="ml-auto"><Swatch choice={{ id: CUSTOM_PALETTE, hue: choice.hue }} size="h-6 w-6" /></span>
        </label>
        <input
          type="range"
          min="0"
          max="359"
          step="1"
          value={choice.hue}
          onChange={(event) => setChoice({ id: CUSTOM_PALETTE, hue: Number(event.target.value) })}
          aria-label="自己调：色相"
          aria-valuetext={`色相 ${choice.hue} 度`}
          className="palette-hue mt-3 w-full"
          style={{ background: HUE_TRACK }}
        />
      </div>
      <p className="mt-2 text-xs text-text-muted">只换这套 App 的颜色，信纸、墨色和压花贴纸不变。不管选哪个颜色，字都看得清。选择会保存在这台设备上。</p>
    </fieldset>
  )
}
