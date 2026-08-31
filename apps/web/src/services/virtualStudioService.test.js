import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

import api from './api'
import { virtualStudioService } from './virtualStudioService'

describe('virtualStudioService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.get.mockResolvedValue({ data: {} })
    api.post.mockResolvedValue({ data: {} })
  })

  it('fetches the image-gen capability status', async () => {
    api.get.mockResolvedValue({ data: { available: false, configured: false, reason: 'IMAGE_GEN_NOT_CONFIGURED' } })

    const status = await virtualStudioService.getImageGenStatus()

    expect(api.get).toHaveBeenCalledWith('/virtual/image-gen/status')
    expect(status).toEqual({ available: false, configured: false, reason: 'IMAGE_GEN_NOT_CONFIGURED' })
  })

  it('sends only whitelisted fields when requesting a generation', async () => {
    await virtualStudioService.requestGeneration({ scene: 'makeup', itemId: 'clear-daily' })

    expect(api.post).toHaveBeenCalledWith('/virtual/image-gen/generations', {
      scene: 'makeup',
      itemId: 'clear-daily',
    })
  })

  it('includes the optional note only when provided', async () => {
    await virtualStudioService.requestGeneration({ scene: 'fitting', itemId: 'khaki-trench', note: '想要更宽松的版型' })

    expect(api.post).toHaveBeenCalledWith('/virtual/image-gen/generations', {
      scene: 'fitting',
      itemId: 'khaki-trench',
      note: '想要更宽松的版型',
    })
  })

  it('propagates the honest 503 seam instead of swallowing it', async () => {
    api.post.mockRejectedValue({
      response: { status: 503, data: { error: '生图能力接入中，暂未开放', code: 'IMAGE_GEN_NOT_CONFIGURED' } },
    })

    await expect(virtualStudioService.requestGeneration({ scene: 'makeup', itemId: 'clear-daily' }))
      .rejects.toMatchObject({ response: { status: 503, data: { code: 'IMAGE_GEN_NOT_CONFIGURED' } } })
  })
})
