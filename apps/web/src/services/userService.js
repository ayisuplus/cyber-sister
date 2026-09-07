import api from './api'

// 形象资产（头像 / 主页背景 / 聊天背景）：multipart 只发本机 API；blob 拉取走鉴权拦截器
export const userService = {
  // putForm 显式 multipart：实例默认 Content-Type 是 JSON，直接 put(FormData) 会让 multer 解析不到文件
  uploadAsset: async (slot, file) => {
    const form = new FormData()
    form.append('file', file)
    const response = await api.putForm(`/user/assets/${slot}`, form)
    return response.data
  },

  // path 为完整路径（含可选 ?v= 缓存破坏；服务端 avatarUrl 带 /api 前缀，需剥掉——axios baseURL 已含）；
  // 未设置（404）或失败一律回落 null
  fetchAssetUrl: async (path) => {
    try {
      const normalized = path?.startsWith('/api/') ? path.slice(4) : path
      const response = await api.get(normalized, { responseType: 'blob' })
      return URL.createObjectURL(response.data)
    } catch {
      return null
    }
  },

  deleteAsset: async (slot) => {
    await api.delete(`/user/assets/${slot}`)
  },
}
