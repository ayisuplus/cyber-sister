import api from './api'

// 3D 衣柜：单品上传生成 GLB，服务端落库 + 文件落盘
export const wardrobeService = {
  list: async () => {
    const response = await api.get('/wardrobe')
    return response.data
  },
  // postForm 显式 multipart：实例默认 Content-Type 是 JSON，直接 post(FormData) 会让 multer 解析不到文件
  create: async (formData) => {
    const response = await api.postForm('/wardrobe', formData)
    return response.data
  },

  remove: async (id) => {
    const response = await api.delete(`/wardrobe/${id}`)
    return response.data
  },
}
