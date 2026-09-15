import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from '../../hooks/useReducedMotion'

function AmbientVideo({ className, videoSrc, imageSrc, paused }) {
  const videoRef = useRef(/** @type {HTMLVideoElement | null} */ (null))
  const [videoFailed, setVideoFailed] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let active = true
    let attempt = 0
    let inView = typeof IntersectionObserver === 'undefined'
    const syncPlayback = () => {
      const currentAttempt = ++attempt
      if (paused || document.hidden || !inView) {
        video.pause()
        return
      }
      video.play().catch(() => {
        if (active && attempt === currentAttempt) setVideoFailed(true)
      })
    }
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      inView = entries.some(entry => entry.isIntersecting)
      syncPlayback()
    })
    observer?.observe(video)
    document.addEventListener('visibilitychange', syncPlayback)
    syncPlayback()

    return () => {
      active = false
      attempt += 1
      observer?.disconnect()
      document.removeEventListener('visibilitychange', syncPlayback)
      video.pause()
    }
  }, [paused, videoFailed])

  if (videoFailed) {
    return <img src={imageSrc} alt="" className={className} />
  }

  return (
    <video
      ref={videoRef}
      aria-hidden="true"
      muted
      loop
      playsInline
      preload="none"
      poster={imageSrc}
      src={videoSrc}
      className={className}
      onError={() => setVideoFailed(true)}
    />
  )
}

/** 氛围视频只在可见时播放；减少动态效果、省流量或播放失败时使用静态贴图。 */
export default function AmbientMedia({
  className = '',
  videoSrc = '/design-assets/workspace-ambient.mp4',
  imageSrc = '/design-assets/banner-workspace.png',
  paused = false,
}) {
  const reducedMotion = useReducedMotion()
  const connection = /** @type {Navigator & { connection?: EventTarget & { saveData?: boolean } }} */ (navigator).connection
  const [saveData, setSaveData] = useState(() => Boolean(connection?.saveData))

  useEffect(() => {
    const onChange = () => setSaveData(Boolean(connection.saveData))
    connection?.addEventListener('change', onChange)
    return () => connection?.removeEventListener('change', onChange)
  }, [connection])

  if (reducedMotion || saveData) {
    return <img src={imageSrc} alt="" className={className} />
  }

  // A new source gets its own playback/error lifecycle, including when returning to an earlier source.
  return <AmbientVideo key={videoSrc} {...{ className, videoSrc, imageSrc, paused }} />
}
