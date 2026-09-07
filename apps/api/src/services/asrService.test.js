import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../prisma/client.js', () => ({ default: {} }))
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { asrBaseUrl, getAsrStatus, transcribeAudio } from './asrService.js'

const ENV = { ASR_BASE_URL: 'http://127.0.0.1:5005' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('asrBaseUrl', () => {
  it('未配置/非法协议/非法 URL 一律 null，合法值去尾斜杠', () => {
    expect(asrBaseUrl({})).toBeNull()
    expect(asrBaseUrl({ ASR_BASE_URL: 'ftp://x' })).toBeNull()
    expect(asrBaseUrl({ ASR_BASE_URL: 'not a url' })).toBeNull()
    expect(asrBaseUrl({ ASR_BASE_URL: 'http://127.0.0.1:5005/' })).toBe('http://127.0.0.1:5005')
  })
})

describe('getAsrStatus', () => {
  it('未配置：configured:false，不发起任何探测', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(getAsrStatus({})).resolves.toEqual({ available: false, configured: false, reason: 'ASR_NOT_CONFIGURED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('已配置但 sidecar 网络异常/health 非 ok：configured:true 且不可用', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('fetch failed'))))
    await expect(getAsrStatus(ENV)).resolves.toEqual({ available: false, configured: true, reason: 'ASR_UNAVAILABLE' })

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })))
    await expect(getAsrStatus(ENV)).resolves.toEqual({ available: false, configured: true, reason: 'ASR_UNAVAILABLE' })
  })

  it('已配置且 health ok：available:true', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getAsrStatus(ENV)).resolves.toEqual({ available: true, configured: true, reason: null })
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:5005/health', expect.objectContaining({}))
  })
})

describe('transcribeAudio', () => {
  const WAV = Buffer.from([0x52, 0x49, 0x46, 0x46])

  it('未配置：503 ASR_NOT_CONFIGURED', async () => {
    await expect(transcribeAudio({ audioBuffer: WAV }, {})).rejects.toMatchObject({ statusCode: 503, code: 'ASR_NOT_CONFIGURED' })
  })

  it('成功：FormData 携带 file 字段转发，返回 text', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ text: '你好' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(transcribeAudio({ audioBuffer: WAV, audioName: 'a.wav', audioMime: 'audio/wav' }, ENV))
      .resolves.toEqual({ text: '你好' })
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:5005/transcribe')
    expect(options.method).toBe('POST')
    expect(options.body).toBeInstanceOf(FormData)
    expect(options.body.get('file')).toBeInstanceOf(Blob)
  })

  it('sidecar 400：原文透传给调用方（音频格式校验失败）', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: '需要 16000Hz 单声道 WAV' }),
    })))
    await expect(transcribeAudio({ audioBuffer: WAV }, ENV))
      .rejects.toMatchObject({ statusCode: 400, message: '需要 16000Hz 单声道 WAV' })
  })

  it('sidecar 500/网络异常/响应形状异常：一律 503 ASR_UNAVAILABLE', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: '推理失败' }),
    })))
    await expect(transcribeAudio({ audioBuffer: WAV }, ENV)).rejects.toMatchObject({ statusCode: 503, code: 'ASR_UNAVAILABLE' })

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('fetch failed'))))
    await expect(transcribeAudio({ audioBuffer: WAV }, ENV)).rejects.toMatchObject({ statusCode: 503, code: 'ASR_UNAVAILABLE' })

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
    await expect(transcribeAudio({ audioBuffer: WAV }, ENV)).rejects.toMatchObject({ statusCode: 503, code: 'ASR_UNAVAILABLE' })
  })
})
