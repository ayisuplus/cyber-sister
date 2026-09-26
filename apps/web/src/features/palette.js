/**
 * 主题色（路线图 C25）：她可以换一套主题色。默认的鼠尾草就是 tokens.css 里手调的那套，不生成、不覆盖；
 * 别的颜色只由一个色相（和一个饱和度系数）生成：每种用途的明暗与饱和度固定，只换色相，
 * 所以不管她选哪个颜色、怎么拖，文字与按钮的对比度都由规则保证（palette.test.js 逐度核对 0–359°）。
 *
 * 只换「这套 App 的颜色」：主操作、淡底色、文字、边框、气泡、环境光。
 * 不换：成功 / 警告 / 危险这些语义色，信纸与三种墨色，本子封皮，阴影；压花、火漆印这些贴纸是图片，也不变。
 */

export const DEFAULT_PALETTE = 'sage'

/** 预设：鼠尾草是现在的样子；其余按色相生成。chroma 是饱和度系数（奶茶淡一些，蓝紫略收） */
export const PALETTES = [
  { id: 'sage', name: '鼠尾草', hue: 125, chroma: 1 },
  { id: 'sakura', name: '樱花粉', hue: 2, chroma: 1 },
  { id: 'peach', name: '蜜桃', hue: 40, chroma: 1 },
  { id: 'milk-tea', name: '奶茶', hue: 62, chroma: 0.55 },
  { id: 'haze-blue', name: '雾霾蓝', hue: 238, chroma: 0.9 },
  { id: 'lavender', name: '薰衣草', hue: 298, chroma: 0.9 },
]
export const CUSTOM_PALETTE = 'custom'

const normalizeHue = (hue) => ((Math.round(Number(hue)) % 360) + 360) % 360

/** 存起来的选择 → { id, hue, chroma }；不认识的一律回到默认 */
export function normalizeChoice(choice) {
  if (choice?.id === CUSTOM_PALETTE && Number.isFinite(Number(choice.hue))) return { id: CUSTOM_PALETTE, hue: normalizeHue(choice.hue), chroma: 1 }
  const preset = PALETTES.find((palette) => palette.id === choice?.id)
  return preset ? { id: preset.id, hue: preset.hue, chroma: preset.chroma } : { id: DEFAULT_PALETTE, hue: PALETTES[0].hue, chroma: 1 }
}

// ── OKLCH → sRGB：超出色域就一点点降饱和，直到落进来 ──
const toGamma = (value) => {
  const clamped = Math.min(1, Math.max(0, value))
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055
}

export function oklchToHex(lightness, chroma, hue) {
  let c = chroma
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const radians = (hue * Math.PI) / 180
    const a = c * Math.cos(radians)
    const b = c * Math.sin(radians)
    const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
    const linear = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ]
    if (linear.every((value) => value >= -0.0005 && value <= 1.0005)) {
      return `#${linear.map((value) => Math.round(toGamma(value) * 255).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
    }
    c *= 0.92
  }
  return '#888888'
}

const alpha = (hex, opacity) => `rgba(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ')}, ${opacity})`

/** WCAG 2 相对亮度与对比度 */
export function contrastRatio(foreground, background) {
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
      .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [light, dark] = [luminance(foreground), luminance(background)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

// 每种用途的 [明度, 饱和度, 色相偏移]：饱和度再乘以这套颜色的系数
const LIGHT_ROLES = {
  '--cs-pastel-blush': [0.955, 0.03, 0],
  '--cs-pastel-mist': [0.94, 0.028, 12],
  '--cs-pastel-sprout': [0.965, 0.028, -12],
  '--cs-pastel-lavender': [0.948, 0.024, 6],
  '--cs-action-primary': [0.5, 0.1, 0],
  '--cs-action-primary-hover': [0.44, 0.1, 0],
  '--cs-action-hover': [0.44, 0.1, 0],
  '--cs-focus-info': [0.42, 0.07, 25],
  '--cs-status-info': [0.42, 0.07, 25],
  '--cs-text-primary': [0.33, 0.03, 0],
  '--cs-text-secondary': [0.42, 0.035, 0],
  '--cs-text-muted': [0.44, 0.035, 0],
  '--cs-surface-page': [0.978, 0.012, 20],
  '--cs-surface-muted': [0.955, 0.016, 20],
  '--cs-border-hairline': [0.915, 0.02, 20],
  '--cs-border-subtle': [0.922, 0.018, 20],
  '--cs-border-default': [0.87, 0.025, 20],
  '--cs-border-control': [0.8, 0.03, 20],
  '--cs-bubble-user': [0.93, 0.032, 0],
}
const DARK_ROLES = {
  '--cs-pastel-blush': [0.31, 0.035, 0],
  '--cs-pastel-mist': [0.315, 0.035, 12],
  '--cs-pastel-sprout': [0.32, 0.03, -12],
  '--cs-pastel-lavender': [0.31, 0.03, 6],
  '--cs-action-primary': [0.82, 0.08, 0],
  '--cs-action-primary-hover': [0.87, 0.07, 0],
  '--cs-action-hover': [0.87, 0.07, 0],
  '--cs-focus-info': [0.83, 0.06, 25],
  '--cs-status-info': [0.83, 0.06, 25],
  '--cs-text-primary': [0.94, 0.015, 0],
  '--cs-text-secondary': [0.83, 0.025, 0],
  '--cs-text-muted': [0.79, 0.03, 0],
  '--cs-text-inverse': [0.22, 0.03, 0],
  '--cs-surface-page': [0.2, 0.02, 0],
  '--cs-surface-card': [0.25, 0.025, 0],
  '--cs-surface-muted': [0.28, 0.025, 0],
  '--cs-surface-input': [0.22, 0.02, 0],
  '--cs-border-hairline': [0.32, 0.02, 0],
  '--cs-border-subtle': [0.34, 0.02, 0],
  '--cs-border-default': [0.45, 0.03, 0],
  '--cs-border-control': [0.6, 0.035, 0],
  '--cs-bubble-user': [0.32, 0.035, 0],
}

function resolve(roles, { hue, chroma }) {
  return Object.fromEntries(Object.entries(roles).map(([name, [l, c, shift]]) => [name, oklchToHex(l, c * chroma, normalizeHue(hue + shift))]))
}

/**
 * 这套颜色的变量：{ light, dark }，每个是 { '--cs-*': 值 }。默认的鼠尾草返回 null（不覆盖，用 tokens.css）。
 */
export function buildPalette(choice) {
  const { id, hue, chroma } = normalizeChoice(choice)
  if (id === DEFAULT_PALETTE) return null
  const light = resolve(LIGHT_ROLES, { hue, chroma })
  const dark = resolve(DARK_ROLES, { hue, chroma })
  // 环境光：一层这套颜色、一层偏一点的邻色，第二层米杏不变
  const glow = (l, c, shift) => oklchToHex(l, c * chroma, normalizeHue(hue + shift))
  light['--cs-glow-1'] = alpha(glow(0.86, 0.06, 0), 0.55)
  light['--cs-glow-3'] = alpha(glow(0.87, 0.05, 25), 0.5)
  dark['--cs-glow-1'] = alpha(glow(0.5, 0.06, 0), 0.22)
  dark['--cs-glow-3'] = alpha(glow(0.48, 0.05, 25), 0.2)
  return { light, dark }
}

/**
 * 注入页面的样式。用 [data-palette] 抬高优先级，不管这段 <style> 和 tokens.css 谁先加载，都压得住默认值；
 * 日夜两套各写一份，切换日夜时不用重算。
 */
export function paletteCss(palette) {
  if (!palette) return ''
  const block = (selector, tokens) => `${selector}{${Object.entries(tokens).map(([name, value]) => `${name}:${value}`).join(';')}}`
  return block(':root[data-palette]', palette.light) + block(':root[data-palette][data-theme="dark"]', palette.dark)
}

/**
 * 设置里的色块：浅色圆底（这套颜色浅的时候什么样）+ 中间一颗主色圆点。
 * 鼠尾草的主色用 tokens.css 的原值。
 */
export function swatchOf(choice) {
  const { hue, chroma } = normalizeChoice(choice)
  const palette = buildPalette(choice)
  return { soft: oklchToHex(0.88, 0.06 * chroma, hue), strong: palette ? palette.light['--cs-action-primary'] : '#5F7049' }
}

/** 「自己调」滑条的底：一圈色相 */
export const HUE_TRACK = `linear-gradient(90deg, ${Array.from({ length: 13 }, (_, at) => oklchToHex(0.62, 0.12, at * 30)).join(', ')})`
