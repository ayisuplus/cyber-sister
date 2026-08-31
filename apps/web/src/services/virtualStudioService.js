import api from './api'

// 生图能力本期为诚实接缝：status 恒 available=false，generations 恒 503。
// 请求体只带契约白名单字段（scene / itemId / 可选 note），绝不发送照片或文件。
export const virtualStudioService = {
  getImageGenStatus: async () => {
    const response = await api.get('/virtual/image-gen/status')
    return response.data
  },

  /**
   * @param {{ scene: 'makeup' | 'fitting', itemId: string, note?: string }} input
   */
  requestGeneration: async ({ scene, itemId, note }) => {
    const payload = { scene, itemId }
    if (note) payload.note = note
    const response = await api.post('/virtual/image-gen/generations', payload)
    return response.data
  },
}
