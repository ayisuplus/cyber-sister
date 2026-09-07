import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'

const svc = vi.hoisted(() => ({
  getAsrStatus: vi.fn(),
  transcribeAudio: vi.fn(),
}))

vi.mock('../services/asrService.js', () => ({
  getAsrStatus: svc.getAsrStatus,
  transcribeAudio: svc.transcribeAudio,
}))
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import asrRoutes from './asr.js'

const WAV_BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00])

const app = express()
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', asrRoutes)

describe('asr 路由', () => {
  it('GET /status 直出能力状态三态', async () => {
    svc.getAsrStatus.mockResolvedValue({ available: true, configured: true, reason: null })
    const response = await request(app).get('/status')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ available: true, configured: true, reason: null })
  })

  it('POST /transcribe 无文件 → 400', async () => {
    const response = await request(app).post('/transcribe')
    expect(response.status).toBe(400)
    expect(response.body.error).toContain('请先提供音频')
    expect(svc.transcribeAudio).not.toHaveBeenCalled()
  })

  it('POST /transcribe MIME 不符 → 400', async () => {
    const response = await request(app)
      .post('/transcribe')
      .attach('file', WAV_BYTES, { filename: 'a.mp3', contentType: 'audio/mpeg' })
    expect(response.status).toBe(400)
    expect(response.body.error).toContain('只支持 WAV')
    expect(svc.transcribeAudio).not.toHaveBeenCalled()
  })

  it('POST /transcribe 正常 WAV：buffer/name/mime 透传给 service，返回 text', async () => {
    svc.transcribeAudio.mockResolvedValue({ text: '你好' })
    const response = await request(app)
      .post('/transcribe')
      .attach('file', WAV_BYTES, { filename: 'voice.wav', contentType: 'audio/wav' })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ text: '你好' })
    expect(svc.transcribeAudio).toHaveBeenCalledWith({
      audioBuffer: expect.any(Buffer),
      audioName: 'voice.wav',
      audioMime: 'audio/wav',
    })
  })

  it('service 503 带 code 透传；400 原文透传', async () => {
    const unavailable = Object.assign(new Error('语音转文字暂不可用，请稍后重试'), { statusCode: 503, code: 'ASR_UNAVAILABLE' })
    svc.transcribeAudio.mockRejectedValueOnce(unavailable)
    const down = await request(app)
      .post('/transcribe')
      .attach('file', WAV_BYTES, { filename: 'voice.wav', contentType: 'audio/wav' })
    expect(down.status).toBe(503)
    expect(down.body.code).toBe('ASR_UNAVAILABLE')

    svc.transcribeAudio.mockRejectedValueOnce(Object.assign(new Error('需要 16000Hz 单声道 WAV'), { statusCode: 400 }))
    const bad = await request(app)
      .post('/transcribe')
      .attach('file', WAV_BYTES, { filename: 'voice.wav', contentType: 'audio/wav' })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('需要 16000Hz 单声道 WAV')
  })
})
