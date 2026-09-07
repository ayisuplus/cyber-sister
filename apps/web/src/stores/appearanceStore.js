import { create } from 'zustand'
import { userService } from '../services/userService'

const SLOT_KEYS = {
  'bg-home': 'homeBgUrl',
  'bg-chat': 'chatBgUrl',
}

// 主页/聊天背景：object URL 是会话级，不 persist；服务端 404 即未设置
export const useAppearanceStore = create((set, get) => ({
  homeBgUrl: null,
  assetUrlCache: {},
  chatBgUrl: null,
  loaded: false,

  loadAppearance: async () => {
    const [homeBgUrl, chatBgUrl] = await Promise.all([
      userService.fetchAssetUrl('/user/assets/bg-home'),
      userService.fetchAssetUrl('/user/assets/bg-chat'),
    ])
    set({ homeBgUrl, chatBgUrl, loaded: true })
  },

  // 头像等按路径共享的 object URL：缓存 Promise 使并发/重复调用只拉一次（服务端 no-store，HTTP 缓存无效）。
  // 会话级不 revoke——换传后 ?v= 变化即新 key，旧 entry 随页面卸载释放；404/失败清缓存以便下次挂载重试
  resolveAssetUrl: (path) => {
    const cached = get().assetUrlCache[path]
    if (cached) return cached
    const pending = userService.fetchAssetUrl(path).then((url) => {
      if (!url) {
        set((s) => {
          const next = { ...s.assetUrlCache }
          delete next[path]
          return { assetUrlCache: next }
        })
      }
      return url
    })
    set((s) => ({ assetUrlCache: { ...s.assetUrlCache, [path]: pending } }))
    return pending
  },

  setBackground: async (slot, file) => {
    await userService.uploadAsset(slot, file)
    const url = await userService.fetchAssetUrl(`/user/assets/${slot}?v=${Date.now()}`)
    const key = SLOT_KEYS[slot]
    const previous = get()[key]
    if (previous) URL.revokeObjectURL(previous)
    set({ [key]: url })
  },

  clearBackground: async (slot) => {
    await userService.deleteAsset(slot)
    const key = SLOT_KEYS[slot]
    const previous = get()[key]
    if (previous) URL.revokeObjectURL(previous)
    set({ [key]: null })
  },
}))
