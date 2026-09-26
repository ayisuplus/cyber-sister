import { create } from 'zustand'
import { buildPalette, CUSTOM_PALETTE, DEFAULT_PALETTE, normalizeChoice, paletteCss } from '../features/palette'

// 主题色（路线图 C25）：和日夜、信纸上的字、小装饰一样是这台设备的偏好，不随登录、退出或账户数据重置。
// 选择存在 amie-palette；算好的样式另存 amie-palette-css，index.html 的启动脚本在样式加载前直接贴上，打开时不闪默认色。
const STORAGE_KEY = 'amie-palette'
const CSS_KEY = 'amie-palette-css'
const STYLE_ID = 'amie-palette'

function readChoice() {
  try {
    return normalizeChoice(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'))
  } catch {
    return normalizeChoice(null)
  }
}

/** 贴上（或撤掉）这套颜色，返回注入的样式；默认的鼠尾草什么都不贴 */
function apply(choice) {
  const css = paletteCss(buildPalette(choice))
  const root = document.documentElement
  let style = document.getElementById(STYLE_ID)
  if (!css) {
    style?.remove()
    delete root.dataset.palette
    return css
  }
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = css
  root.dataset.palette = choice.id
  return css
}

function remember(choice, css) {
  try {
    if (choice.id === DEFAULT_PALETTE) {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(CSS_KEY)
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice.id === CUSTOM_PALETTE ? { id: choice.id, hue: choice.hue } : { id: choice.id }))
    localStorage.setItem(CSS_KEY, css)
  } catch {
    // 禁用本地存储时，本次打开仍可切换
  }
}

export const usePaletteStore = create((set) => ({
  choice: readChoice(),
  setChoice(value) {
    const choice = normalizeChoice(value)
    remember(choice, apply(choice))
    set({ choice })
  },
}))

export function startPaletteSync() {
  const choice = readChoice()
  usePaletteStore.setState({ choice })
  // 生成规则以后调过的话，启动时按现在的规则重算并更新缓存，下次启动脚本贴的就是新的
  remember(choice, apply(choice))

  const onStorage = (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return
    try {
      if (event.storageArea && event.storageArea !== localStorage) return
    } catch {
      return
    }
    const next = readChoice()
    usePaletteStore.setState({ choice: next })
    apply(next)
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
