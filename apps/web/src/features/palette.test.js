import { describe, expect, it } from 'vitest'
import { buildPalette, contrastRatio, CUSTOM_PALETTE, normalizeChoice, oklchToHex, paletteCss, PALETTES } from './palette'

// tokens.css 里不随主题色变的：日间卡片与输入框是白的，语义色固定
const FIXED = {
  light: { '--cs-surface-card': '#FFFFFF', '--cs-surface-input': '#FFFFFF', '--cs-text-inverse': '#FFFFFF', '--cs-status-local': '#53633B', '--cs-warning': '#8A5A00', '--cs-danger': '#B42318' },
  dark: { '--cs-status-local': '#B3CE99', '--cs-warning': '#E7C477', '--cs-danger': '#FFA99F' },
}
const SURFACES = ['--cs-surface-card', '--cs-surface-page', '--cs-surface-muted', '--cs-surface-input', '--cs-pastel-blush', '--cs-pastel-mist', '--cs-pastel-sprout', '--cs-pastel-lavender', '--cs-bubble-user']
const TEXTS = ['--cs-text-primary', '--cs-text-secondary', '--cs-text-muted']
// 主操作色与信息色也当字用（链接、选中的小字）；语义色当状态字用
const TEXTLIKE = ['--cs-action-primary', '--cs-focus-info', '--cs-status-local', '--cs-warning', '--cs-danger']

/** 一套颜色里所有没过 4.5 的组合 */
function failures(choice) {
  const palette = buildPalette(choice)
  const found = []
  for (const mode of ['light', 'dark']) {
    const tokens = { ...FIXED[mode], ...palette[mode] }
    const check = (fg, bg) => {
      const ratio = contrastRatio(tokens[fg], tokens[bg])
      if (ratio < 4.5) found.push(`${mode} ${fg} on ${bg}: ${ratio.toFixed(2)}`)
    }
    for (const bg of SURFACES) for (const fg of TEXTS) check(fg, bg)
    for (const bg of ['--cs-surface-card', '--cs-surface-page', '--cs-pastel-blush']) for (const fg of TEXTLIKE) check(fg, bg)
    // 按钮上的字：主操作色与悬停色上的反白字
    check('--cs-text-inverse', '--cs-action-primary')
    check('--cs-text-inverse', '--cs-action-primary-hover')
  }
  return found
}

describe('主题色', () => {
  it('默认的鼠尾草不生成、不覆盖：和 tokens.css 一模一样', () => {
    expect(buildPalette({ id: 'sage' })).toBeNull()
    expect(buildPalette(null)).toBeNull()
    expect(buildPalette({ id: '不认识的' })).toBeNull()
    expect(paletteCss(null)).toBe('')
  })

  it('每套预设：正文、小字、链接与按钮上的字，日间夜间都至少 4.5:1', () => {
    for (const preset of PALETTES.filter((palette) => palette.id !== 'sage')) {
      expect(failures({ id: preset.id }), preset.name).toEqual([])
    }
  })

  it('自己调：0–359° 每一度都至少 4.5:1', () => {
    const bad = []
    for (let hue = 0; hue < 360; hue += 1) bad.push(...failures({ id: CUSTOM_PALETTE, hue }).map((line) => `${hue}° ${line}`))
    expect(bad).toEqual([])
  })

  it('色相越界、乱写都收回来；自己调的饱和度固定', () => {
    expect(normalizeChoice({ id: CUSTOM_PALETTE, hue: 725 })).toEqual({ id: CUSTOM_PALETTE, hue: 5, chroma: 1 })
    expect(normalizeChoice({ id: CUSTOM_PALETTE, hue: -10 })).toEqual({ id: CUSTOM_PALETTE, hue: 350, chroma: 1 })
    expect(normalizeChoice({ id: CUSTOM_PALETTE, hue: 'abc' })).toMatchObject({ id: 'sage' })
    expect(normalizeChoice({ id: 'milk-tea' })).toEqual({ id: 'milk-tea', hue: 62, chroma: 0.55 })
  })

  it('OKLCH 换算落在色域里：白、黑与一个饱和到出界的颜色', () => {
    expect(oklchToHex(1, 0, 0)).toBe('#FFFFFF')
    expect(oklchToHex(0, 0, 0)).toBe('#000000')
    expect(oklchToHex(0.7, 0.4, 150)).toMatch(/^#[0-9A-F]{6}$/)
  })

  it('注入的样式用 [data-palette] 压过默认值，日夜各一段', () => {
    const css = paletteCss(buildPalette({ id: 'sakura' }))
    expect(css).toMatch(/^:root\[data-palette\]\{--cs-pastel-blush:#[0-9A-F]{6};/)
    expect(css).toContain(':root[data-palette][data-theme="dark"]{')
    expect(css).toContain('--cs-glow-1:rgba(')
    // 信纸、墨色与语义色不在里面
    expect(css).not.toMatch(/--cs-(paper|ink|danger|warning|status-local)/)
  })
})
