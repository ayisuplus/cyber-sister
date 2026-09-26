import api from './api'

// 花草图鉴（路线图 C26）。照片先在这台设备上压缩成 JPEG（原图 + 缩略图）再传；认一认只传原图、不落盘。
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

export const gardenService = {
  list: async (status) => (await api.get('/garden', { params: { status } })).data.entries,
  identify: async (photo) => {
    const form = new FormData()
    form.append('photo', photo, 'photo.jpg')
    return (await api.postForm('/garden/identify', form)).data
  },
  // postForm / putForm 显式 multipart：实例默认 Content-Type 是 JSON
  create: async (fields, photos) => (await api.postForm('/garden', toForm(fields, photos))).data,
  update: async (id, fields, photos) => (await api.putForm(`/garden/${id}`, toForm(fields, photos))).data,
  remove: async (id) => (await api.delete(`/garden/${id}`)).data,
}
