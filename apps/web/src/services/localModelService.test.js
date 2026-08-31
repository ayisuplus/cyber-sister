import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}))

import api from './api'
import { localModelService } from './localModelService'

describe('localModelService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.get.mockResolvedValue({ data: {} })
    api.post.mockResolvedValue({ data: {} })
    api.put.mockResolvedValue({ data: {} })
  })

  it('uses the controlled host preset for one-click discovery', async () => {
    await localModelService.detect('host')
    expect(api.post).toHaveBeenCalledWith('/admin/llm/local/detect', { preset: 'host' })
  })

  it('never sends a llama.cpp key from the browser', async () => {
    await localModelService.test({ baseUrl: 'http://host.docker.internal:8080/v1', model: 'friend-8b' })
    await localModelService.update({ enabled: true, baseUrl: 'http://host.docker.internal:8080/v1', model: 'friend-8b' })

    expect(api.post).toHaveBeenCalledWith('/admin/llm/local/test', {
      baseUrl: 'http://host.docker.internal:8080/v1',
      model: 'friend-8b',
    })
    expect(api.put).toHaveBeenCalledWith('/admin/llm/local/config', {
      enabled: true,
      baseUrl: 'http://host.docker.internal:8080/v1',
      model: 'friend-8b',
    })
  })
})
