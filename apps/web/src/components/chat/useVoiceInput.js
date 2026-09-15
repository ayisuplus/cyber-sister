/**
 * 语音输入 hook：idle → recording → transcribing 状态机。
 * 麦克风权限拒绝/浏览器不支持/服务不可用都如实置 error，不假装在录。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { asrService } from '../../services/asrService'
import { webmToWav16kMono } from '../../utils/voiceWav'

const MAX_RECORD_MS = 90_000

export function useVoiceInput(onTranscript, enabled = true) {
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const operationRef = useRef(0)
  const requestRef = useRef(null)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const timerRef = useRef(null)
  // mount 探测一次可用性；失败按不可用（点击时再如实报错）
  const availableRef = useRef(null)

  useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    availableRef.current = null
    asrService.getAsrStatus()
      .then((status) => { if (alive) availableRef.current = Boolean(status?.available) })
      .catch(() => { if (alive) availableRef.current = false })
    return () => { alive = false }
  }, [enabled])

  const releaseRecorder = useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = null
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder) recorder.stream.getTracks().forEach((track) => track.stop())
  }, [])

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
  }, [releaseRecorder])

  useEffect(() => cancel, [cancel])
  useEffect(() => { if (!enabled) cancel() }, [enabled, cancel])

  const start = useCallback(async () => {
    if (!enabledRef.current) return
    const operation = ++operationRef.current
    const current = () => enabledRef.current && operation === operationRef.current
    setError('')
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
        if (text) onTranscript(text)
        else setError('没有听清，请再说一次')
      } catch (err) {
        if (current()) setError(err?.response?.data?.error || '语音转文字失败，请重试')
      } finally {
        if (current()) { requestRef.current = null; setState('idle') }
      }
    }
    recorderRef.current = recorder
    recorder.start()
    timerRef.current = setTimeout(stop, MAX_RECORD_MS)
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

  return { state, error, toggle }
}
