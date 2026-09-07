import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    postForm: vi.fn(),
  },
}))

import api from './api'
import { asrService } from './asrService'

describe('asrService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.get.mockResolvedValue({ data: {} })
    api.postForm.mockResolvedValue({ data: {} })
  })

  it('fetches the voice capability status', async () => {
    api.get.mockResolvedValue({ data: { available: true, configured: true, reason: null } })

    const status = await asrService.getAsrStatus()

    expect(api.get).toHaveBeenCalledWith('/asr/status')
    expect(status).toEqual({ available: true, configured: true, reason: null })
  })

  it('uploads the wav as multipart file field', async () => {
    api.postForm.mockResolvedValue({ data: { text: '你好' } })
    const wav = new Blob(['wav-bytes'], { type: 'audio/wav' })

    const result = await asrService.transcribeAudio(wav)

    expect(api.postForm).toHaveBeenCalledWith('/asr/transcribe', expect.any(FormData))
    const formData = api.postForm.mock.calls[0][1]
    expect(formData.get('file')).toBeInstanceOf(Blob)
    expect(result).toEqual({ text: '你好' })
  })
})
