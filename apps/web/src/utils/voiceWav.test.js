import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeWavPcm16, webmToWav16kMono } from './voiceWav'

const ascii = (view, offset, length) => String.fromCharCode(...Array.from({ length }, (_, i) => view.getUint8(offset + i)))

describe('encodeWavPcm16', () => {
  it('写出合法的 16k 单声道 PCM16 RIFF 头与数据', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2])
    const view = new DataView(encodeWavPcm16(samples, 16000))

    expect(ascii(view, 0, 4)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(36 + samples.length * 2)
    expect(ascii(view, 8, 4)).toBe('WAVE')
    expect(ascii(view, 12, 4)).toBe('fmt ')
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // 单声道
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint32(28, true)).toBe(32000) // 字节率
    expect(view.getUint16(34, true)).toBe(16) // 位深
    expect(ascii(view, 36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(samples.length * 2)

    expect(view.getInt16(44, true)).toBe(0)
    expect(view.getInt16(46, true)).toBe(Math.round(0.5 * 32767))
    expect(view.getInt16(48, true)).toBe(Math.round(-0.5 * 32767))
    expect(view.getInt16(50, true)).toBe(32767)
    expect(view.getInt16(52, true)).toBe(-32767)
    expect(view.getInt16(54, true)).toBe(32767) // 超幅截断
  })
})

describe('webmToWav16kMono', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('解码 → 重采样 16k 单声道 → 产出 audio/wav Blob', async () => {
    const rendered = { getChannelData: () => new Float32Array([0, 0.5]) }
    const source = { connect: vi.fn(), start: vi.fn(), buffer: null }
    const offline = {
      createBufferSource: vi.fn(() => source),
      destination: {},
      startRendering: vi.fn().mockResolvedValue(rendered),
    }
    const decoded = { duration: 0.5 }
    const audioContext = { decodeAudioData: vi.fn().mockResolvedValue(decoded), close: vi.fn() }
    vi.stubGlobal('AudioContext', vi.fn(function () { return audioContext }))
    vi.stubGlobal('OfflineAudioContext', vi.fn(function (channels, frames, rate) {
      expect(channels).toBe(1)
      expect(frames).toBe(8000)
      expect(rate).toBe(16000)
      return offline
    }))

    const webm = new Blob(['webm'], { type: 'audio/webm' })
    webm.arrayBuffer = async () => new ArrayBuffer(8) // jsdom Blob 无 arrayBuffer（浏览器有）
    const blob = await webmToWav16kMono(webm)

    expect(source.buffer).toBe(decoded)
    expect(offline.startRendering).toHaveBeenCalled()
    expect(audioContext.close).toHaveBeenCalled()
    expect(blob.type).toBe('audio/wav')
    expect(blob.size).toBe(44 + 2 * 2)
  })
})
