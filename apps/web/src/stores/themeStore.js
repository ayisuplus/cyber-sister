import { create } from 'zustand'

const STORAGE_KEY = 'amie-theme'
const normalizePreference = (value) => ['light', 'dark'].includes(value) ? value : 'system'

function readPreference() {
  try {
    return normalizePreference(localStorage.getItem(STORAGE_KEY))
  } catch {
    return 'system'
  }
}

function applyTheme(preference) {
  const dark = preference === 'dark'
    || (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const theme = dark ? 'dark' : 'light'
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

// 用户主动切换时像天色渐变一样过渡；不支持 View Transition 或要求减少动效时立即切换。
function applyThemeGently(preference) {
  if (typeof document.startViewTransition !== 'function'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    applyTheme(preference)
    return
  }
  document.startViewTransition(() => applyTheme(preference))
}

// 外观属于本机偏好，不随登录、退出或账户数据重置。
export const useThemeStore = create((set) => ({
  preference: readPreference(),
  setPreference(value) {
    const preference = normalizePreference(value)
    try {
      localStorage.setItem(STORAGE_KEY, preference)
    } catch {
      // 禁用本地存储时，本次打开仍可切换外观。
    }
    set({ preference })
    applyThemeGently(preference)
  },
}))

export function startThemeSync() {
  const preference = readPreference()
  useThemeStore.setState({ preference })
  applyTheme(preference)

  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const onSystemChange = () => {
    if (useThemeStore.getState().preference === 'system') applyTheme('system')
  }
  const onStorage = (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return
    // 同名 sessionStorage 事件不应改变这项设备偏好。
    try {
      if (event.storageArea && event.storageArea !== localStorage) return
    } catch {
      return
    }
    const next = normalizePreference(event.newValue)
    useThemeStore.setState({ preference: next })
    applyTheme(next)
  }

  media.addEventListener('change', onSystemChange)
  window.addEventListener('storage', onStorage)
  return () => {
    media.removeEventListener('change', onSystemChange)
    window.removeEventListener('storage', onStorage)
  }
}
