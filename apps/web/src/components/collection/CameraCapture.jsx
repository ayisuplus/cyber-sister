import { useEffect, useRef, useState } from 'react'

const buttonClass = 'min-h-11 flex-1 rounded-2xl border border-border-default bg-surface-card px-4 text-sm text-text-secondary'

// 电脑上的「拍一张」：页面里打开摄像头拍一张（手机上直接用系统相机，不走这里）。
// 没有摄像头或没给权限时如实说，并给一个从相册选的出口。
/** @param {{ onCapture: (file: File) => void, onCancel: () => void, onFallback: () => void }} props */
export default function CameraCapture({ onCapture, onCancel, onFallback }) {
  const supported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(supported ? '' : '这台设备打不开相机。')

  useEffect(() => {
    if (!supported) return undefined
    let alive = true
    navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment', width: { ideal: 1600 } } })
      .then((stream) => {
        if (!alive) { stream.getTracks().forEach((track) => track.stop()); return }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
      })
      .catch(() => { if (alive) setError('相机没打开：可能没有摄像头，或者还没允许使用相机。') })
    return () => {
      alive = false
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [supported])

  const capture = () => {
    const video = videoRef.current
    if (!video?.videoWidth || !video.videoHeight) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) { setError('没拍下来，请重试。'); return }
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) { setError('没拍下来，请重试。'); return }
      onCapture(new File([blob], 'camera.jpg', { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.92)
  }

  return (
    <section aria-label="拍一张" className="rounded-card bg-surface-card p-4 shadow-card">
      {error ? (
        <p role="alert" className="text-sm text-text-secondary">{error}</p>
      ) : (
        <video ref={videoRef} autoPlay playsInline muted aria-label="相机取景" onLoadedMetadata={() => setReady(true)} className="max-h-80 w-full rounded-2xl bg-black object-contain" />
      )}
      <div className="mt-3 flex gap-2">
        {error
          ? <button type="button" onClick={onFallback} className={buttonClass}>从相册选</button>
          : <button type="button" onClick={capture} disabled={!ready} className="min-h-11 flex-1 rounded-2xl bg-action-primary px-4 text-sm font-semibold text-text-inverse disabled:opacity-50">拍下来</button>}
        <button type="button" onClick={onCancel} className={buttonClass}>取消</button>
      </div>
    </section>
  )
}
