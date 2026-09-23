import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLevelMeter, rmsLevel } from './voiceLevel'

afterEach(() => vi.unstubAllGlobals())

describe('rmsLevel', () => {
  it('分贝刻度：-60 dBFS 以下是 0，-10 dBFS 以上是 1，气声也看得见', () => {
    expect(rmsLevel(new Float32Array(512))).toBe(0)
    expect(rmsLevel([])).toBe(0)
    // -70 dBFS 的底噪算没声音
    expect(rmsLevel(new Float32Array(512).fill(0.000316))).toBe(0)
    // -40 dBFS 左右的气声也有 0.4，高过「像说话」的门槛 0.2
    expect(rmsLevel(new Float32Array(512).fill(0.01))).toBeCloseTo(0.4)
    // -20 dBFS 正常说话 0.8，不至于顶满
    expect(rmsLevel(new Float32Array(512).fill(0.1))).toBeCloseTo(0.8)
    expect(rmsLevel(new Float32Array(512).fill(0.9))).toBe(1)
  })
})

describe('createLevelMeter', () => {
  it('浏览器没有 AudioContext 或建不起来时返回 null，录音照常', () => {
    vi.stubGlobal('AudioContext', undefined)
    vi.stubGlobal('webkitAudioContext', undefined)
    expect(createLevelMeter({})).toBeNull()

    vi.stubGlobal('AudioContext', class { constructor() { throw new Error('blocked') } })
    expect(createLevelMeter({})).toBeNull()
  })

  it('读的是麦克风的时域采样，用完断开并关掉', () => {
    const source = { connect: vi.fn(), disconnect: vi.fn() }
    const analyser = {
      fftSize: 0,
      getFloatTimeDomainData: vi.fn((samples) => samples.fill(0.01)),
    }
    const close = vi.fn(() => Promise.resolve())
    vi.stubGlobal('AudioContext', class {
      createMediaStreamSource() { return source }
      createAnalyser() { return analyser }
      resume() { return Promise.resolve() }
      close() { return close() }
    })

    const levelMeter = createLevelMeter({})
    expect(source.connect).toHaveBeenCalledWith(analyser)
    expect(levelMeter.read()).toBeCloseTo(0.4)
    levelMeter.close()
    expect(source.disconnect).toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
  })
})
