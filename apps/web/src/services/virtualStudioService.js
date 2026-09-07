import api from './api'

// 生图走本机 ComfyUI：照片以 multipart 只发送到本机 API（同机转发给本地 ComfyUI），
// 不经过任何外部服务；请求只带契约白名单字段（photo / scene / itemId / 可选 note）。
export const virtualStudioService = {
  getImageGenStatus: async () => {
    const response = await api.get('/virtual/image-gen/status')
    return response.data
  },

  /**
   * @param {{ scene: 'makeup' | 'fitting', itemId: string, note?: string, photo: File }} input
   */
  requestGeneration: async ({ scene, itemId, note, photo }) => {
    const formData = new FormData()
    formData.append('scene', scene)
    formData.append('itemId', itemId)
    if (note) formData.append('note', note)
    formData.append('photo', photo)
    const response = await api.postForm('/virtual/image-gen/generations', formData)
    return response.data
  },
}
