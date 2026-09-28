import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 假的 Web Audio：只记下排了哪些音、音量怎么走，不真的出声
class FakeAudioContext {
  static instances = []
  static blocked = false

  constructor() {
    this.state = 'suspended'
    this.currentTime = 10
    this.destination = {}
    this.oscillators = []
    this.gains = []
    FakeAudioContext.instances.push(this)
  }

  async resume() { if (!FakeAudioContext.blocked) this.state = 'running' }
  async suspend() { this.state = 'suspended' }

  createOscillator() {
    const oscillator = { frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
    this.oscillators.push(oscillator)
    return oscillator
  }

  createGain() {
    const gain = {
      gain: { value: 0.1, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
    this.gains.push(gain)
    return gain
  }
}

const load = async () => {
  vi.resetModules()
  return import('./chime.js')
}

beforeEach(() => {
  FakeAudioContext.instances = []
  FakeAudioContext.blocked = false
  vi.stubGlobal('AudioContext', FakeAudioContext)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('八音盒铃声', () => {
  it('解锁：在点击里恢复一下再挂起，不空转', async () => {
    const { unlockAudio } = await load()
    await expect(unlockAudio()).resolves.toBe(true)
    expect(FakeAudioContext.instances).toHaveLength(1)
    expect(FakeAudioContext.instances[0].state).toBe('suspended')
  })

  it('响起：一分钟内从很轻升到适中，三分钟的音一次排好；停下时渐弱、停掉每个音并挂起', async () => {
    vi.useFakeTimers()
    const { startChime, CHIME_MAX_MS } = await load()
    const stop = await startChime()
    expect(stop).toEqual(expect.any(Function))
    const audio = FakeAudioContext.instances[0]
    const master = audio.gains[0]
    expect(master.gain.setValueAtTime).toHaveBeenCalledWith(0.03, 10.05)
    expect(master.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.32, 70.05)
    // 每句 12 个音、每个音三个泛音，三分钟排了好几十句
    expect(audio.oscillators.length % 36).toBe(0)
    expect(audio.oscillators.length / 36).toBeGreaterThan(30)
    const lastStart = Math.max(...audio.oscillators.map((oscillator) => oscillator.start.mock.calls[0][0]))
    expect(lastStart - 10).toBeLessThanOrEqual(CHIME_MAX_MS / 1000)

    stop()
    expect(master.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 10.15)
    await vi.advanceTimersByTimeAsync(250)
    expect(audio.oscillators.every((oscillator) => oscillator.stop.mock.calls.length === 2)).toBe(true)
    expect(master.disconnect).toHaveBeenCalled()
    expect(audio.state).toBe('suspended')
  })

  it('三分钟后自己停', async () => {
    vi.useFakeTimers()
    const { startChime, CHIME_MAX_MS } = await load()
    await startChime()
    const master = FakeAudioContext.instances[0].gains[0]
    await vi.advanceTimersByTimeAsync(CHIME_MAX_MS + 250)
    expect(master.disconnect).toHaveBeenCalled()
  })

  it('浏览器不让出声：返回 null，调用方如实说', async () => {
    FakeAudioContext.blocked = true
    const { startChime, previewChime } = await load()
    await expect(startChime()).resolves.toBeNull()
    await expect(previewChime()).resolves.toBeNull()
  })

  it('没有 Web Audio：不能出声', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const { canPlaySound, startChime, unlockAudio } = await load()
    expect(canPlaySound()).toBe(false)
    await expect(startChime()).resolves.toBeNull()
    await expect(unlockAudio()).resolves.toBe(false)
  })

  it('能不能出声看这次打开后有没有被点过', async () => {
    const { canPlaySound } = await load()
    vi.stubGlobal('navigator', { userActivation: { hasBeenActive: false } })
    expect(canPlaySound()).toBe(false)
    vi.stubGlobal('navigator', { userActivation: { hasBeenActive: true } })
    expect(canPlaySound()).toBe(true)
  })

  it('试听：一句、不渐强', async () => {
    vi.useFakeTimers()
    const { previewChime } = await load()
    const stop = await previewChime()
    const audio = FakeAudioContext.instances[0]
    expect(audio.gains[0].gain.linearRampToValueAtTime).not.toHaveBeenCalled()
    expect(audio.oscillators).toHaveLength(36)
    stop()
    await vi.advanceTimersByTimeAsync(250)
    expect(audio.gains[0].disconnect).toHaveBeenCalled()
  })

  it('第一次点击或按键时解锁，只解锁一次；卸载后不再监听', async () => {
    const { installAudioUnlock } = await load()
    const uninstall = installAudioUnlock()
    window.dispatchEvent(new Event('pointerdown'))
    window.dispatchEvent(new Event('keydown'))
    await Promise.resolve()
    expect(FakeAudioContext.instances).toHaveLength(1)
    uninstall()

    const again = await load()
    const off = again.installAudioUnlock()
    off()
    window.dispatchEvent(new Event('pointerdown'))
    expect(FakeAudioContext.instances).toHaveLength(1)
  })
})
