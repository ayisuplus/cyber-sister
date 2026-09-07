import api from './api'

// 形象资产（头像 / 主页背景 / 聊天背景）：multipart 只发本机 API；blob 拉取走鉴权拦截器

// 数据导出与迁移：导出为鉴权 GET 的 JSON 下载；导入见 POST /user/import（preview/apply）
export const migrationService = {
  // 导出全部自有数据为 JSON 文件并触发浏览器下载（凭据/危机日志不外发，见服务端注释）
  downloadExport: async () => {
    const response = await api.get('/user/export', { responseType: 'blob' })
    const disposition = response.headers?.['content-disposition'] || ''
    const match = disposition.match(/filename="?([^";]+)"?/)
    const filename = match?.[1] || `cyber-sister-export-${new Date().toISOString().slice(0, 10)}.json`
    const url = URL.createObjectURL(response.data)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
    return filename
  },

  // 导入预览：解析导出包/人设文本为结构化候选，不落库
  previewImport: async (payload) => {
    const response = await api.post('/user/import/preview', payload)
    return response.data
  },

  // 导入应用：把用户确认的候选落库（角色扮演过恋人红线闸）
  applyImport: async (payload) => {
    const response = await api.post('/user/import/apply', payload)
    return response.data
  },
}
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
