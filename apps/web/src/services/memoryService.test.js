import { describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

import api from './api'
import { memoryService } from './memoryService'

describe('memoryService.list', () => {
  it('loads every page so all explicit memories remain manageable', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `m${index}` }))
    api.get
      .mockResolvedValueOnce({ data: { data: firstPage, total: 101 } })
      .mockResolvedValueOnce({ data: { data: [{ id: 'm100' }], total: 101 } })

    const memories = await memoryService.list()

    expect(memories).toHaveLength(101)
    expect(api.get).toHaveBeenNthCalledWith(2, '/memories', { params: { page: 2, limit: 100 } })
  })

  it('caps pagination at 50 pages when the reported total is absurd', async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({ id: `m${index}` }))
    api.get.mockResolvedValue({ data: { data: fullPage, total: 1_000_000_000 } })

    await memoryService.list()

    // 首页 + 第 2..50 页，共 50 次请求，而不是一千万页
    expect(api.get).toHaveBeenCalledTimes(50)
    expect(api.get).toHaveBeenLastCalledWith('/memories', { params: { page: 50, limit: 100 } })
  })

  it('ignores a non-numeric total and trusts only the first page', async () => {
    api.get.mockResolvedValue({ data: { data: [{ id: 'm1' }], total: 'not-a-number' } })

    const memories = await memoryService.list()

    expect(memories).toEqual([{ id: 'm1' }])
    expect(api.get).toHaveBeenCalledTimes(1)
  })

  it('returns an array payload directly without pagination', async () => {
    api.get.mockResolvedValue({ data: [{ id: 'm1' }, { id: 'm2' }] })

    const memories = await memoryService.list()

    expect(memories).toEqual([{ id: 'm1' }, { id: 'm2' }])
    expect(api.get).toHaveBeenCalledTimes(1)
  })
})

describe('memoryService.getSuggestions', () => {
  it('requests candidates for the given user message and returns the payload', async () => {
    api.post.mockResolvedValue({
      data: { candidates: [{ type: 'semantic', content: '喜欢科幻电影', importance: 7, tags: ['电影'] }] },
    })

    const result = await memoryService.getSuggestions('u1')

    expect(api.post).toHaveBeenCalledWith('/memories/suggestions', { messageId: 'u1' })
    expect(result.candidates).toHaveLength(1)
  })

  it('propagates suggestion failures to the caller for inline handling', async () => {
    const failure = new Error('LOCAL_LLM_UNAVAILABLE')
    api.post.mockRejectedValue(failure)

    await expect(memoryService.getSuggestions('u1')).rejects.toBe(failure)
  })
})

describe('memoryService mutations', () => {
  it('creates, updates, removes and clears memories', async () => {
    api.post.mockResolvedValue({ data: { id: 'm1' } })
    api.put.mockResolvedValue({ data: { id: 'm1', content: '更新' } })
    api.delete.mockResolvedValue({ data: {} })

    const created = await memoryService.create({ content: '新记忆' })
    const updated = await memoryService.update('m1', { content: '更新' })
    await memoryService.remove('m1')
    await memoryService.clear()

    expect(api.post).toHaveBeenCalledWith('/memories', { content: '新记忆' })
    expect(created).toEqual({ id: 'm1' })
    expect(api.put).toHaveBeenCalledWith('/memories/m1', { content: '更新' })
    expect(updated).toEqual({ id: 'm1', content: '更新' })
    expect(api.delete).toHaveBeenNthCalledWith(1, '/memories/m1')
    expect(api.delete).toHaveBeenNthCalledWith(2, '/memories')
  })
})
