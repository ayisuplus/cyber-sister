/**
 * 语音输入 hook：idle → recording → transcribing 状态机。
 * 麦克风权限拒绝/浏览器不支持/服务不可用都如实置 error，不假装在录；没配语音服务时 configured 为 false，界面不放麦克风。
 * 深夜小声说话时让她知道「在听」：录音中给出已录时长与音量，一直没听到像说话的声音才提示靠近一点。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { asrService } from '../../services/asrService'
import { webmToWav16kMono } from '../../utils/voiceWav'
import { createLevelMeter } from '../../utils/voiceLevel'

export const MAX_RECORD_MS = 90_000
const TICK_MS = 100
// 录了这么久还一直没听到像说话的声音，才提示靠近一点；说到一半的停顿不算。
// 0.2 约是 -50 dBFS：比夜里安静房间的底噪高，比贴着手机的气声低（经验值，要用真人录音再校）
const QUIET_AFTER_MS = 3000
const SPEECH_LEVEL = 0.2
export const AUTO_STOP_NOTICE = '到 90 秒了，先写下这些；想接着说，再点一下麦克风'

const CJK_EDGE_END = /[\s\u{3000}-\u{303f}\u{ff00}-\u{ffef}\u{4e00}-\u{9fff}]$/u
const CJK_EDGE_START = /^[\s\u{3000}-\u{303f}\u{ff00}-\u{ffef}\u{4e00}-\u{9fff}]/u

/** 两段转写接起来：挨着中文或中文标点就直接接，只有英文、数字碰在一起才隔一个空格。 */
export function appendTranscript(previous, next) {
  if (!previous) return next
  if (!next) return previous
  return CJK_EDGE_END.test(previous) || CJK_EDGE_START.test(next) ? `${previous}${next}` : `${previous} ${next}`
}

export function useVoiceInput(onTranscript, enabled = true) {
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // null 探测中 | true 配了语音服务 | false 没配（或探测失败）
  const [configured, setConfigured] = useState(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  // null 表示取不到音量（不显示音量条）
  const [level, setLevel] = useState(null)
  const [quiet, setQuiet] = useState(false)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const operationRef = useRef(0)
  const requestRef = useRef(null)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const timerRef = useRef(null)
  const tickRef = useRef(null)
  const meterRef = useRef(null)
  const autoStoppedRef = useRef(false)
  // mount 探测一次：没配或探测失败就不放麦克风；配了但连不上，点击时再如实报错
  const availableRef = useRef(null)

  useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    availableRef.current = null
    asrService.getAsrStatus()
      .then((status) => {
        if (!alive) return
        availableRef.current = Boolean(status?.available)
        setConfigured(Boolean(status?.configured))
      })
      .catch(() => {
        if (!alive) return
        availableRef.current = false
        setConfigured(false)
      })
    return () => { alive = false }
  }, [enabled])

  const stopMeter = useCallback(() => {
    clearInterval(tickRef.current)
    tickRef.current = null
    meterRef.current?.close()
    meterRef.current = null
  }, [])

  const releaseRecorder = useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = null
    stopMeter()
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder) recorder.stream.getTracks().forEach((track) => track.stop())
  }, [stopMeter])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }, [])

  // 取消、停用（enabled 为 false）或卸载均废弃本次权限请求、录音、转换及转写结果。
  const cancel = useCallback(() => {
    operationRef.current += 1
    requestRef.current?.abort()
    requestRef.current = null
    chunksRef.current = []
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    releaseRecorder()
    setState('idle')
    setError('')
    setNotice('')
  }, [releaseRecorder])

  useEffect(() => cancel, [cancel])
  useEffect(() => { if (!enabled) cancel() }, [enabled, cancel])

  const clearNotice = useCallback(() => setNotice(''), [])

  const start = useCallback(async () => {
    if (!enabledRef.current) return
    const operation = ++operationRef.current
    const current = () => enabledRef.current && operation === operationRef.current
    setError('')
    setNotice('')
    if (availableRef.current === false) {
      setError('语音转文字暂不可用，请稍后重试')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('当前浏览器不支持录音')
      return
    }
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      if (!current()) return
      setError(err?.name === 'NotAllowedError' ? '麦克风权限被拒绝' : '无法打开麦克风')
      return
    }
    if (!current()) { stream.getTracks().forEach(track => track.stop()); return }
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    chunksRef.current = []
    recorder.ondataavailable = (event) => {
      if (current() && event.data?.size > 0) chunksRef.current.push(event.data)
    }
    recorder.onerror = () => {
      if (!current()) return
      releaseRecorder()
      setState('idle')
      setError('录音失败，请重试')
    }
    recorder.onstop = async () => {
      if (!current()) return
      const chunks = chunksRef.current
      chunksRef.current = []
      releaseRecorder()
      if (chunks.length === 0) {
        setState('idle')
        return
      }
      const controller = new AbortController()
      requestRef.current = controller
      setState('transcribing')
      try {
        const wav = await webmToWav16kMono(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
        if (!current()) return
        const { text } = await asrService.transcribeAudio(wav, { signal: controller.signal })
        if (!current()) return
        if (text) {
          onTranscript(text)
          if (autoStoppedRef.current) setNotice(AUTO_STOP_NOTICE)
        } else {
          setError('没有听清，请再说一次')
        }
      } catch (err) {
        if (current()) setError(err?.response?.data?.error || '语音转文字失败，请重试')
      } finally {
        if (current()) { requestRef.current = null; setState('idle') }
      }
    }
    recorderRef.current = recorder
    recorder.start()
    autoStoppedRef.current = false
    timerRef.current = setTimeout(() => {
      autoStoppedRef.current = true
      stop()
    }, MAX_RECORD_MS)
    // 音量与时长：取不到音量就只走时长，不判断小声
    const meter = createLevelMeter(stream)
    meterRef.current = meter
    const startedAt = Date.now()
    let loudest = 0
    setElapsedMs(0)
    setLevel(meter ? 0 : null)
    setQuiet(false)
    tickRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt
      const reading = meter ? meter.read() : null
      if (reading !== null) loudest = Math.max(loudest, reading)
      setElapsedMs(elapsed)
      setLevel(reading)
      setQuiet(reading !== null && elapsed >= QUIET_AFTER_MS && loudest < SPEECH_LEVEL)
    }, TICK_MS)
    setState('recording')
  }, [onTranscript, releaseRecorder, stop])

  const toggle = useCallback(() => {
    if (state === 'recording') stop()
    else if (state === 'idle') start()
  }, [state, start, stop])

  // 仅录音期间挂 Esc 取消；空闲/转写中不拦截
  useEffect(() => {
    if (state !== 'recording') return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [state, cancel])

  return { state, error, notice, clearNotice, configured, elapsedMs, level, quiet, toggle }
}
