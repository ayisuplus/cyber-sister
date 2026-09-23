import api from './api'

// 「装扮」里的收藏：衣柜与化妆间共用。照片先在这台设备上压缩成 JPEG（原图 + 缩略图）再传。
function toForm(fields, photos) {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) form.append(key, value)
  }
  if (photos) {
    form.append('photo', photos.photo, 'photo.jpg')
    form.append('thumb', photos.thumb, 'thumb.jpg')
  }
  return form
}

export const collectionService = {
  list: async (shelf) => (await api.get('/collection', { params: { shelf } })).data.items,
  // postForm / putForm 显式 multipart：实例默认 Content-Type 是 JSON
  create: async (fields, photos) => (await api.postForm('/collection', toForm(fields, photos))).data,
  update: async (id, fields, photos) => (await api.putForm(`/collection/${id}`, toForm(fields, photos))).data,
  remove: async (id) => (await api.delete(`/collection/${id}`)).data,
}
