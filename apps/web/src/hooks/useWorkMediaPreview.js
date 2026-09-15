import { useCallback, useEffect, useRef, useState } from 'react'
import { getSessionVersion, onSessionReset } from '../services/sessionLifecycle'

// 两个图片工具共用请求生命周期，换图、换参数、退出后都不能展示旧结果。
export default function useWorkMediaPreview(preview) {
  const [file, setFileState] = useState(null)
  const [imageUrl, setImageUrl] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(null)

  const invalidate = useCallback(() => {
    pending.current?.abort()
    pending.current = null
    setResult(null)
    setBusy(false)
    setError('')
  }, [])

  const setFile = useCallback(next => {
    invalidate()
    setFileState(next)
  }, [invalidate])

  useEffect(() => {
    if (!file) { setImageUrl(''); return }
    const url = URL.createObjectURL(file)
    setImageUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    const unsubscribe = onSessionReset(() => setFile(null))
    return () => { unsubscribe(); pending.current?.abort(); pending.current = null }
  }, [setFile])

  const submit = async (...args) => {
    if (!file || pending.current) return
    const controller = new AbortController()
    const session = getSessionVersion()
    pending.current = controller
    setBusy(true)
    setError('')
    setResult(null)
    const current = () => pending.current === controller && session === getSessionVersion()
    try {
      const response = await preview(file, ...args, { signal: controller.signal })
      if (current()) setResult(response)
    } catch (err) {
      if (current()) setError(err.response?.data?.error || '模拟预览失败，请重试')
    } finally {
      if (current()) { pending.current = null; setBusy(false) }
    }
  }

  return { file, imageUrl, result, busy, error, setFile, invalidate, submit }
}
