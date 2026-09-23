/**
 * 录音时的音量，让她看得到「在听」：AudioContext + AnalyserNode 取时域采样算均方根。
 * 取不到（浏览器不支持、被策略挡住）就返回 null——不显示音量条，录音照常。
 */

/**
 * 时域采样（-1..1）→ 0..1 的音量，按分贝刻度：-60 dBFS（安静的房间）是 0，-10 dBFS（贴着麦克风说话）是 1。
 * 线性刻度下正常说话会把音量条顶满、气声几乎不动；分贝刻度让小声、气声也看得见起伏。
 */
export function rmsLevel(samples) {
  if (!samples?.length) return 0
  let sum = 0
  for (const value of samples) sum += value * value
  const rms = Math.sqrt(sum / samples.length)
  if (rms <= 0) return 0
  return Math.min(1, Math.max(0, (20 * Math.log10(rms) + 60) / 50))
}

/** @param {MediaStream} stream @returns {{ read: () => number, close: () => void } | null} */
export function createLevelMeter(stream) {
  const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext
  if (!AudioContextClass || !stream) return null
  try {
    const context = new AudioContextClass()
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)
    // iOS Safari 在 await 之后建的 AudioContext 可能是挂起的
    context.resume?.()?.catch?.(() => {})
    const samples = new Float32Array(analyser.fftSize)
    return {
      read() {
        analyser.getFloatTimeDomainData(samples)
        return rmsLevel(samples)
      },
      close() {
        source.disconnect()
        context.close?.()?.catch?.(() => {})
      },
    }
  } catch {
    return null
  }
}
