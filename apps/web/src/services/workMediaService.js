import api from './api'

export const workMediaService = {
  /** @param {File} image @param {{smooth:number,whiten:number,slim:number,eye:number}} params @param {{signal?: AbortSignal}} options */
  previewMakeup: async (image, params, { signal } = {}) => {
    const data = new FormData()
    data.append('image', image)
    data.append('params', JSON.stringify(params))
    const response = await api.postForm('/work/media/makeup/preview', data, { signal })
    return response.data
  },
  /** @param {File} image @param {string} name @param {{signal?: AbortSignal}} options */
  previewWardrobe: async (image, name, { signal } = {}) => {
    const data = new FormData()
    data.append('image', image)
    data.append('name', name.trim())
    const response = await api.postForm('/work/media/wardrobe/preview', data, { signal })
    return response.data
  },
}
