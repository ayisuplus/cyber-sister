import { create } from 'zustand'

// 小装饰（压花、叶子、火漆印、邮票、日期旁的小画）：默认有，喜欢干净的可以关掉（路线图 C18）。
// 和信纸上的字一样是这台设备的偏好，不随登录、退出或账户数据重置。
const STORAGE_KEY = 'amie-decor'
const normalize = (value) => (value === 'off' ? 'off' : 'on')

function readPreference() {
  try {
    return normalize(localStorage.getItem(STORAGE_KEY))
  } catch {
    return 'on'
  }
}

const apply = (decor) => { document.documentElement.dataset.decor = decor }

export const useDecorStore = create((set) => ({
  decor: readPreference(),
  setDecor(value) {
    const decor = normalize(value)
    try {
      localStorage.setItem(STORAGE_KEY, decor)
    } catch {
      // 禁用本地存储时，本次打开仍可切换
    }
    set({ decor })
    apply(decor)
  },
}))

export function startDecorSync() {
  const decor = readPreference()
  useDecorStore.setState({ decor })
  apply(decor)
}
