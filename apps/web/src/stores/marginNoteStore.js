import { create } from 'zustand'

// 页边铅笔批注（她写这一段时翻过的书）：默认有，不想看的可以关掉（路线图 C21）。
// 和小装饰一样是这台设备的偏好，不随登录、退出或账户数据重置。
const STORAGE_KEY = 'amie-margin-notes'
const normalize = (value) => (value === 'off' ? 'off' : 'on')

function readPreference() {
  try {
    return normalize(localStorage.getItem(STORAGE_KEY))
  } catch {
    return 'on'
  }
}

export const useMarginNoteStore = create((set) => ({
  marginNotes: readPreference(),
  setMarginNotes(value) {
    const marginNotes = normalize(value)
    try {
      localStorage.setItem(STORAGE_KEY, marginNotes)
    } catch {
      // 禁用本地存储时，本次打开仍可切换
    }
    set({ marginNotes })
  },
}))
