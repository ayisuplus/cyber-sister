// 早安闹钟的铃声（路线图 C28）：用 Web Audio 现合成的八音盒，没有音频文件，也就没有版权问题。
// 五声音阶的一小段琶音，每个音像拨了一下音片：起得快、慢慢消下去；总音量一分钟内从很轻升到适中，
// 三分钟后自己停。整段在开始时一次排好，页面切到后台、计时器被浏览器放慢也照样响。
//
// 浏览器不许网页没被点过就出声：在应用里第一次点击或按键时解锁（见 installAudioUnlock），
// 之后闹钟到点再恢复。一直没被点过（比如夜里页面被刷新了）就出不了声，只能靠系统通知——睡眠卡上如实写着。

const PENTATONIC = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, D6: 1174.66, E6: 1318.51 }
// 一句：上行再回落，落在高一点的音上；两句之间空一拍
const PHRASE = ['E5', 'G5', 'A5', 'C6', 'D6', 'C6', 'A5', 'G5', 'E5', 'G5', 'A5', 'E6']
const NOTE_SECONDS = 0.34
const PHRASE_SECONDS = PHRASE.length * NOTE_SECONDS + 1.2
// 音片的泛音：基频、八度、再高一点的一丝亮
const PARTIALS = [[1, 1], [2, 0.28], [3.01, 0.07]]
const RISE_SECONDS = 60
const START_GAIN = 0.03
const PEAK_GAIN = 0.32
export const CHIME_MAX_MS = 3 * 60 * 1000
const PREVIEW_SECONDS = PHRASE_SECONDS

let context = null

const AudioContextClass = () => globalThis.AudioContext ?? globalThis.webkitAudioContext ?? null

function ensureContext() {
  if (context) return context
  const Klass = AudioContextClass()
  if (!Klass) return null
  try {
    context = new Klass()
  } catch {
    context = null
  }
  return context
}

/** 在一次点击或按键里调用：让之后到点时能出声。解锁后先挂起，不空转耗电。 */
export async function unlockAudio() {
  const audio = ensureContext()
  if (!audio) return false
  try {
    await audio.resume()
    const running = audio.state === 'running'
    if (running) await audio.suspend()
    return running
  } catch {
    return false
  }
}

/** 这个页面还能不能出声：浏览器支持，且这次打开后被点过。 */
export function canPlaySound() {
  if (!AudioContextClass()) return false
  const activation = typeof navigator !== 'undefined' ? navigator.userActivation : undefined
  if (activation) return activation.hasBeenActive
  return context !== null
}

/** 第一次点击或按键时解锁；返回卸载函数。 */
export function installAudioUnlock() {
  if (typeof window === 'undefined') return () => {}
  const unlock = () => {
    unlockAudio()
    window.removeEventListener('pointerdown', unlock, true)
    window.removeEventListener('keydown', unlock, true)
  }
  window.addEventListener('pointerdown', unlock, true)
  window.addEventListener('keydown', unlock, true)
  return () => {
    window.removeEventListener('pointerdown', unlock, true)
    window.removeEventListener('keydown', unlock, true)
  }
}

function pluck(audio, destination, frequency, at) {
  const nodes = []
  for (const [ratio, level] of PARTIALS) {
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency * ratio, at)
    // 高的泛音消得更快，像金属音片
    const decay = 1.4 / ratio
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(level, at + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay)
    oscillator.connect(gain)
    gain.connect(destination)
    oscillator.start(at)
    oscillator.stop(at + decay + 0.05)
    nodes.push(oscillator)
  }
  return nodes
}

function play(seconds, { rise }) {
  const audio = ensureContext()
  if (!audio) return null
  const master = audio.createGain()
  master.connect(audio.destination)
  const begin = audio.currentTime + 0.05
  if (rise) {
    master.gain.setValueAtTime(START_GAIN, begin)
    master.gain.linearRampToValueAtTime(PEAK_GAIN, begin + RISE_SECONDS)
  } else {
    master.gain.setValueAtTime(PEAK_GAIN * 0.6, begin)
  }
  const oscillators = []
  for (let phraseStart = 0; phraseStart + PHRASE_SECONDS <= seconds + 0.001; phraseStart += PHRASE_SECONDS) {
    PHRASE.forEach((note, index) => {
      oscillators.push(...pluck(audio, master, PENTATONIC[note], begin + phraseStart + index * NOTE_SECONDS))
    })
  }
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    const now = audio.currentTime
    try {
      master.gain.cancelScheduledValues(now)
      master.gain.setValueAtTime(master.gain.value, now)
      master.gain.linearRampToValueAtTime(0, now + 0.15)
    } catch {
      // 已经停了
    }
    setTimeout(() => {
      for (const oscillator of oscillators) {
        try { oscillator.stop() } catch { /* 早就停了 */ }
      }
      master.disconnect()
      audio.suspend?.().catch?.(() => {})
    }, 200)
  }
}

/**
 * 闹钟响起：恢复声音、排好三分钟的铃声。出不了声时返回 null（调用方如实告诉她）。
 * 返回的函数用来停下（渐弱 0.15 秒，不突然掐断）。
 */
export async function startChime() {
  const audio = ensureContext()
  if (!audio) return null
  try {
    await audio.resume()
  } catch {
    return null
  }
  if (audio.state !== 'running') return null
  const stop = play(CHIME_MAX_MS / 1000, { rise: true })
  if (!stop) return null
  const timer = setTimeout(stop, CHIME_MAX_MS)
  return () => {
    clearTimeout(timer)
    stop()
  }
}

/** 睡眠卡上的「试听」：一句、中等音量；点按钮本身就解锁了声音。 */
export async function previewChime() {
  const audio = ensureContext()
  if (!audio) return null
  try {
    await audio.resume()
  } catch {
    return null
  }
  if (audio.state !== 'running') return null
  const stop = play(PREVIEW_SECONDS, { rise: false })
  const timer = setTimeout(() => stop?.(), PREVIEW_SECONDS * 1000 + 1500)
  return () => {
    clearTimeout(timer)
    stop?.()
  }
}
