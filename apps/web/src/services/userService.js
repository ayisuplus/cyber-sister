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
    anchor.hidden = true
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    // 给浏览器下载处理器读取 Blob 的时间，不能在同一调用栈提前撤销。
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
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
// 用户资料（设置页真实开关等）：GET/PUT /user/profile
export const profileService = {
  get: async () => (await api.get('/user/profile')).data,
  update: async (payload) => (await api.put('/user/profile', payload)).data,
}

// 人设库：用户自己定义的「她」（GET/POST /user/personas、PUT/DELETE /user/personas/:id）；
// 换她走 authService.updatePersona（PUT /user/persona），不在这里。
export const personaService = {
  list: async () => (await api.get('/user/personas')).data,
  // 建卡即启用：body 就是人设卡字段
  create: async (card) => (await api.post('/user/personas', card)).data,
  // 改一改这张卡；不改变谁在启用
  update: async (id, card) => (await api.put(`/user/personas/${id}`, card)).data,
  // 删她：只剩一个时服务端回 400「至少留一个她」，原样展示
  remove: async (id) => (await api.delete(`/user/personas/${id}`)).data,

  // 蒸馏草稿（不落库）：先说清来源类型（original 自己想的 / fiction 虚构角色 / public_figure 公众人物 / friend 朋友），
  // 再给素材文字 + 最多 4 张图片 + 是否顺手查公开资料（'false' 才关；只有虚构角色与公众人物才会真的查）。
  // label 是原作或人物名；friend 要带 attested（用户的声明），且不收图片。缺省 kind 按 original，旧界面照常能用。
  distill: async ({ material = '', images = [], research = true, kind = 'original', label = '', attested = false } = {}) => {
    const form = new FormData()
    form.append('material', material)
    form.append('research', research ? 'true' : 'false')
    form.append('kind', kind)
    if (label) form.append('label', label)
    if (attested) form.append('attested', 'true')
    for (const image of images) form.append('images', image)
    // postForm 显式 multipart：实例默认 Content-Type 是 JSON，直接 post(FormData) 会让 multer 解析不到文件
    return (await api.postForm('/user/personas/distill', form)).data
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
