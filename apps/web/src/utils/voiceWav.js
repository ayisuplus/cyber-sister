/**
 * 语音录制音频转码：Float32 PCM → WAV 文件字节，webm/opus 录音 → 16kHz 单声道 WAV。
 * 全链路零 ffmpeg：Chromium 可解码自身 MediaRecorder 产出的 webm/opus，
 * 经 OfflineAudioContext 重采样到 16k 单声道后编码 PCM16 WAV 上传。
 */

/** Float32 单声道采样 → PCM16 WAV 字节（纯函数，可单测）。 */
export function encodeWavPcm16(samples, sampleRate) {
  const count = samples.length
  const buffer = new ArrayBuffer(44 + count * 2)
  const view = new DataView(buffer)
  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + count * 2, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt 块长度
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // 单声道
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // 字节率
  view.setUint16(32, 2, true) // 块对齐
  view.setUint16(34, 16, true) // 位深
  writeAscii(36, 'data')
  view.setUint32(40, count * 2, true)
  for (let i = 0; i < count; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true)
  }
  return buffer
}

/** MediaRecorder 产出（webm/opus 等）→ 16kHz 单声道 WAV Blob。 */
export async function webmToWav16kMono(blob) {
  const audioContext = new AudioContext()
  try {
    const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer())
    const target = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000)
    const source = target.createBufferSource()
    source.buffer = decoded
    source.connect(target.destination)
    source.start()
    const rendered = await target.startRendering()
    return new Blob([encodeWavPcm16(rendered.getChannelData(0), 16000)], { type: 'audio/wav' })
  } finally {
    audioContext.close()
  }
}
