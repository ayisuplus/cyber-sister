import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    postForm: vi.fn(),
  },
}))

import api from './api'
import { virtualStudioService } from './virtualStudioService'

describe('virtualStudioService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.get.mockResolvedValue({ data: {} })
    api.postForm.mockResolvedValue({ data: {} })
  })

  it('fetches the image-gen capability status', async () => {
    api.get.mockResolvedValue({ data: { available: true, configured: true, provider: 'comfy', reason: null } })

    const status = await virtualStudioService.getImageGenStatus()

    expect(api.get).toHaveBeenCalledWith('/virtual/image-gen/status')
    expect(status).toEqual({ available: true, configured: true, provider: 'comfy', reason: null })
  })

  it('sends the photo and whitelisted fields as multipart form data', async () => {
    const photo = new File(['pixels'], 'selfie.png', { type: 'image/png' })

    await virtualStudioService.requestGeneration({ scene: 'makeup', itemId: 'clear-daily', photo })

    expect(api.postForm).toHaveBeenCalledWith('/virtual/image-gen/generations', expect.any(FormData))
    const formData = api.postForm.mock.calls[0][1]
    expect(formData.get('scene')).toBe('makeup')
    expect(formData.get('itemId')).toBe('clear-daily')
    expect(formData.get('photo')).toBe(photo)
    expect(formData.get('note')).toBeNull()
  })

  it('includes the optional note only when provided', async () => {
    const photo = new File(['pixels'], 'outfit.png', { type: 'image/png' })

    await virtualStudioService.requestGeneration({ scene: 'fitting', itemId: 'khaki-trench', note: '想要更宽松的版型', photo })

    const formData = api.postForm.mock.calls[0][1]
    expect(formData.get('note')).toBe('想要更宽松的版型')
  })

  it('propagates the honest 503 seam instead of swallowing it', async () => {
    api.postForm.mockRejectedValue({
      response: { status: 503, data: { error: '本地生图服务暂不可用，请稍后重试', code: 'IMAGE_GEN_UNAVAILABLE' } },
    })

    await expect(virtualStudioService.requestGeneration({
      scene: 'makeup',
      itemId: 'clear-daily',
      photo: new File(['pixels'], 'selfie.png', { type: 'image/png' }),
    })).rejects.toMatchObject({ response: { status: 503, data: { code: 'IMAGE_GEN_UNAVAILABLE' } } })
  })
})
