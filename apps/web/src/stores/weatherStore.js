import { create } from 'zustand'
import { weatherService } from '../services/weatherService'
import { getSessionVersion, onSessionReset } from '../services/sessionLifecycle'

// 半小时内不重复拉；服务器那边也按半小时缓存
const FRESH_MS = 30 * 60 * 1000

const initial = { weather: null, status: 'idle', fetchedAt: 0 }

/**
 * status：idle 还没拉过 / none 没填城市 / ready 有天气 / error 取不到。
 * 取不到时连同旧数据一起收起来：界面不显示天气，不显示可能过期的天气。
 */
export const useWeatherStore = create((set, get) => ({
  ...initial,

  async load({ force = false } = {}) {
    const { fetchedAt, status } = get()
    if (!force && status !== 'idle' && Date.now() - fetchedAt < FRESH_MS) return
    const version = getSessionVersion()
    try {
      const data = await weatherService.getWeather()
      if (version !== getSessionVersion()) return
      set(data?.place ? { weather: data, status: 'ready', fetchedAt: Date.now() } : { weather: null, status: 'none', fetchedAt: Date.now() })
    } catch {
      if (version !== getSessionVersion()) return
      set({ weather: null, status: 'error', fetchedAt: Date.now() })
    }
  },

  async setPlace(place) {
    await weatherService.setPlace(place)
    await get().load({ force: true })
  },

  async clearPlace() {
    await weatherService.clearPlace()
    set({ weather: null, status: 'none', fetchedAt: Date.now() })
  },

  reset() {
    set(initial)
  },
}))

onSessionReset(() => useWeatherStore.getState().reset())
