import { create } from 'zustand'
import { userService } from '../services/userService'
import { assertSessionVersion, getSessionVersion, onSessionReset } from '../services/sessionLifecycle'

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
    const session = getSessionVersion()
    const [homeBgUrl, chatBgUrl] = await Promise.all([
      userService.fetchAssetUrl('/user/assets/bg-home'),
      userService.fetchAssetUrl('/user/assets/bg-chat'),
    ])
    if (session !== getSessionVersion()) {
      if (homeBgUrl) URL.revokeObjectURL(homeBgUrl)
      if (chatBgUrl) URL.revokeObjectURL(chatBgUrl)
      return
    }
    const previous = get()
    if (previous.homeBgUrl) URL.revokeObjectURL(previous.homeBgUrl)
    if (previous.chatBgUrl) URL.revokeObjectURL(previous.chatBgUrl)
    set({ homeBgUrl, chatBgUrl, loaded: true })
  },

  // 头像等按路径共享的 object URL：缓存 Promise 使并发/重复调用只拉一次（服务端 no-store，HTTP 缓存无效）。
  // 身份切换时清缓存并撤销 URL；404/失败清缓存以便下次挂载重试。
  resolveAssetUrl: (path) => {
    const session = getSessionVersion()
    const cached = get().assetUrlCache[path]
    if (cached) return cached
    const pending = userService.fetchAssetUrl(path).then((url) => {
      if (session !== getSessionVersion()) {
        if (url) URL.revokeObjectURL(url)
        return null
      }
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
    const session = getSessionVersion()
    await userService.uploadAsset(slot, file)
    assertSessionVersion(session)
    const url = await userService.fetchAssetUrl(`/user/assets/${slot}?v=${Date.now()}`)
    if (session !== getSessionVersion()) {
      if (url) URL.revokeObjectURL(url)
      assertSessionVersion(session)
    }
    const key = SLOT_KEYS[slot]
    const previous = get()[key]
    if (previous) URL.revokeObjectURL(previous)
    set({ [key]: url })
  },

  clearBackground: async (slot) => {
    const session = getSessionVersion()
    await userService.deleteAsset(slot)
    assertSessionVersion(session)
    const key = SLOT_KEYS[slot]
    const previous = get()[key]
    if (previous) URL.revokeObjectURL(previous)
    set({ [key]: null })
  },
}))

onSessionReset(() => {
  const { homeBgUrl, chatBgUrl, assetUrlCache } = useAppearanceStore.getState()
  if (homeBgUrl) URL.revokeObjectURL(homeBgUrl)
  if (chatBgUrl) URL.revokeObjectURL(chatBgUrl)
  for (const pending of Object.values(assetUrlCache)) {
    pending.then((url) => { if (url) URL.revokeObjectURL(url) }).catch(() => {})
  }
  useAppearanceStore.setState({ homeBgUrl: null, chatBgUrl: null, loaded: false, assetUrlCache: {} })
})
