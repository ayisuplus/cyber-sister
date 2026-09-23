import { create } from 'zustand'

// 信纸上的字：默认手写（霞鹜文楷），读手写吃力时可以换成印刷体。只换字，信纸、横格、翻页都不变。
// 和外观一样是这台设备的偏好，不随登录、退出或账户数据重置。
const STORAGE_KEY = 'amie-letter-font'
const normalize = (value) => (value === 'print' ? 'print' : 'hand')

function readPreference() {
  try {
    return normalize(localStorage.getItem(STORAGE_KEY))
  } catch {
    return 'hand'
  }
}

const apply = (font) => { document.documentElement.dataset.letterFont = font }

export const useLetterFontStore = create((set) => ({
  font: readPreference(),
  setFont(value) {
    const font = normalize(value)
    try {
      localStorage.setItem(STORAGE_KEY, font)
    } catch {
      // 禁用本地存储时，本次打开仍可切换
    }
    set({ font })
    apply(font)
  },
}))

export function startLetterFontSync() {
  const font = readPreference()
  useLetterFontStore.setState({ font })
  apply(font)
}
