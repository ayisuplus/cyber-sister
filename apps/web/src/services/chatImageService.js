import { userService } from './userService'

// 聊天图片 messageId → object URL：pending-promise 会话缓存（同 appearanceStore.resolveAssetUrl 模式），
// 同一消息只拉一次；服务端 no-store，HTTP 缓存无效。会话级不 revoke，随页面卸载释放；
// 失败清缓存以便下次渲染重试，调用方拿到 null 不渲染。
const pendingById = new Map()

export function getChatImageUrl(messageId) {
  const cached = pendingById.get(messageId)
  if (cached) return cached
  const pending = userService.fetchAssetUrl(`/chat/images/${messageId}`).then((url) => {
    if (!url) pendingById.delete(messageId)
    return url
  })
  pendingById.set(messageId, pending)
  return pending
}
