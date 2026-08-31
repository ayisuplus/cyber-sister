import api from './api'
// 防御异常 total：最多翻 50 页（5000 条），避免脏数据驱动无限拉取
const MAX_MEMORY_PAGES = 50

export const memoryService = {
  list: async () => {
    const first = await api.get('/memories', { params: { page: 1, limit: 100 } })
    if (Array.isArray(first.data)) return first.data

    const memories = [...(first.data.data || [])]
    const rawTotal = Number(first.data.total)
    const total = Number.isFinite(rawTotal) && rawTotal > 0 ? rawTotal : memories.length
    const totalPages = Math.min(Math.ceil(total / 100), MAX_MEMORY_PAGES)
    for (let page = 2; page <= totalPages; page += 1) {
      const response = await api.get('/memories', { params: { page, limit: 100 } })
      memories.push(...(response.data.data || []))
    }
    return memories
  },
  create: async (memory) => {
    const response = await api.post('/memories', memory)
    return response.data
  },
  update: async (id, memory) => {
    const response = await api.put(`/memories/${id}`, memory)
    return response.data
  },
  remove: async (id) => {
    await api.delete(`/memories/${id}`)
  },
  clear: async () => {
    await api.delete('/memories')
  },
}
