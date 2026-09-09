import { useCallback, useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { Camera, Download, ImagePlus, ShieldCheck } from 'lucide-react'
import Header from '../components/layout/Header'
import BeautyCanvas from '../components/beauty/BeautyCanvas'
import SliderPanel from '../components/beauty/SliderPanel'
import CompareHoldButton from '../components/beauty/CompareHoldButton'
import Modal from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { BEAUTY_PRESETS } from '../features/beauty/presets'
import { createBeautyEngine } from '../features/beauty/beautyEngine'
import { createBeautyPipeline } from '../features/beauty/beautyPipeline'
import { TIERS, decideTier, updateEma } from '../features/beauty/degradePolicy'
import { makeupPresetService } from '../services/makeupPresetService'

const MAX_FRAME_WIDTH = TIERS[0].width // 相机打开与静态图的宽度上限（不受降级影响）
const FALLBACK_FRAME_SIZE = { width: 640, height: 480 }

const DEFAULT_PRESET = BEAUTY_PRESETS.find(preset => preset.id === 'natural') || BEAUTY_PRESETS[0]

// 把源尺寸等比收进画布，宽不超过 maxWidth（实时模式随性能档位收窄）。
function fitCanvas(canvas, sourceWidth, sourceHeight, maxWidth = MAX_FRAME_WIDTH) {
  const scale = Math.min(1, maxWidth / sourceWidth)
  canvas.width = Math.max(1, Math.round(sourceWidth * scale))
  canvas.height = Math.max(1, Math.round(sourceHeight * scale))
}

export default function MakeupRoomPage() {
  const [mode, setMode] = useState('camera') // 'camera' 拍一张 | 'photo' 选照片
  const [captured, setCaptured] = useState(false) // 是否已有一帧静态画面可保存
  const [streaming, setStreaming] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [engineError, setEngineError] = useState('')
  const [photoError, setPhotoError] = useState('')
  const [photo, setPhoto] = useState(null)
  const [activePresetId, setActivePresetId] = useState(DEFAULT_PRESET.id)
  const [settings, setSettings] = useState({ ...DEFAULT_PRESET.settings })
  const [showOriginal, setShowOriginal] = useState(false)
  const [degraded, setDegraded] = useState(false) // 已降档：预览区给出温和提示
  // 自定义妆容预设：服务端落库；加载失败只提示，不影响美颜主流程
  const [customPresets, setCustomPresets] = useState([])
  const [presetError, setPresetError] = useState('')
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [renaming, setRenaming] = useState(null) // null | 待重命名的预设
  const [renameName, setRenameName] = useState('')
  const [deleting, setDeleting] = useState(null) // null | 待删除的预设

  const videoRef = useRef(null)
  const displayRef = useRef(null)
  const fileInputRef = useRef(null)
  const streamRef = useRef(null)
  const pipelineRef = useRef(null)
  const frameCanvasRef = useRef(null)
  const sourceCanvasRef = useRef(null)
  const processedRef = useRef(null)
  const photoUrlRef = useRef(null)
  const sourceVersionRef = useRef(0) // 源图版本号：换图/重拍递增，作 landmarks 缓存键
  // 静态模式处理调度：processing 在飞守卫（与相机 rAF 循环同思路）+ generation 判过期
  const staticJobRef = useRef({ processing: false, pending: false, rafId: 0, generation: 0 })
  const settingsRef = useRef(settings)
  const showOriginalRef = useRef(showOriginal)
  const tierRef = useRef(0) // 当前性能档位（TIERS 下标）
  const emaRef = useRef(/** @type {number | null} */ (null)) // 单帧耗时 EMA
  const sinceRef = useRef(0) // 上次换档（或本轮预览开始）的时间戳

  if (!frameCanvasRef.current && typeof document !== 'undefined') {
    frameCanvasRef.current = document.createElement('canvas')
    sourceCanvasRef.current = document.createElement('canvas')
  }

  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => { showOriginalRef.current = showOriginal }, [showOriginal])

  // 卸载时释放照片 ObjectURL
  useEffect(() => () => {
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current)
  }, [])

  const getPipeline = useCallback(() => {
    if (!pipelineRef.current) {
      pipelineRef.current = createBeautyPipeline({ engine: createBeautyEngine() })
    }
    return pipelineRef.current
  }, [])

  // 本地美颜处理：任何失败都不影响看原图，照片始终不出设备。
  // processImage 是异步的（引擎推理需要时间），失败时回退原图。
  // 静态模式传 landmarkKey：同一源图只检测一次，滑杆只重跑滤镜/形变。
  const runBeauty = useCallback(async (frameCanvas, nextSettings, landmarkKey) => {
    try {
      const options = landmarkKey != null ? { landmarkKey } : undefined
      const result = await getPipeline().processImage(frameCanvas, nextSettings, options)
      processedRef.current = result
      setEngineError('')
      return result
    } catch {
      setEngineError('美颜引擎启动失败，当前先显示原图；照片始终只在这台设备上。')
      return frameCanvas
    }
  }, [getPipeline])
  // 实时模式专用：每帧处理耗时喂给 EMA，按策略换档（静态拍照/选图不经过这里）。
  const applyFrameTiming = useCallback((sampleMs) => {
    emaRef.current = updateEma(emaRef.current, sampleMs)
    const nowMs = performance.now()
    const decision = decideTier({ emaMs: emaRef.current, tier: tierRef.current, sinceMs: sinceRef.current, nowMs })
    if (!decision.changed) return
    tierRef.current = decision.tier
    sinceRef.current = nowMs
    setDegraded(decision.tier > 0)
  }, [])

  // 相机模式：getUserMedia 实时预览，rAF 循环里 video → pipeline → canvas。
  useEffect(() => {
    if (mode !== 'camera' || captured) return undefined
    let cancelled = false
    let rafId = 0
    let lastFrameAt = 0
    let processing = false
    const videoElement = videoRef.current
    // 新一轮预览重置性能状态
    tierRef.current = 0
    emaRef.current = null
    sinceRef.current = performance.now()
    setDegraded(false)

    const tick = (now) => {
      if (cancelled) return
      rafId = requestAnimationFrame(tick)
      // 上一帧还在推理就跳过：既不堆积异步任务，也避免处理途中覆写 frame 画布。
      if (processing) return
      const activeTier = TIERS[tierRef.current] || TIERS[0]
      if (now - lastFrameAt < activeTier.intervalMs) return
      lastFrameAt = now
      const video = videoRef.current
      const frame = frameCanvasRef.current
      if (!video || !frame || !video.videoWidth) return
      fitCanvas(frame, video.videoWidth, video.videoHeight, activeTier.width)
      const ctx = frame.getContext('2d')
      if (ctx) ctx.drawImage(video, 0, 0, frame.width, frame.height)
      if (showOriginalRef.current) {
        displayRef.current?.draw(frame)
        return
      }
      processing = true
      const startedAt = performance.now()
      runBeauty(frame, settingsRef.current)
        .then((output) => { if (!cancelled && output) displayRef.current?.draw(output) })
        .finally(() => {
          processing = false
          if (!cancelled) applyFrameTiming(performance.now() - startedAt)
        })
    }

    const startCamera = async () => {
      setStreaming(false)
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('这台设备打不开相机，可以改用「选照片」。')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: MAX_FRAME_WIDTH } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop())
          return
        }
        streamRef.current = stream
        setCameraError('')
        setStreaming(true)
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          const playAttempt = video.play?.()
          playAttempt?.catch?.(() => {})
        }
        rafId = requestAnimationFrame(tick)
      } catch {
        if (!cancelled) setCameraError('相机权限被拒绝或相机不可用。请检查设备的相机权限，或改用「选照片」。')
      }
    }

    startCamera()
    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      streamRef.current?.getTracks().forEach(track => track.stop())
      streamRef.current = null
      if (videoElement) videoElement.srcObject = null
    }
  }, [mode, captured, runBeauty, applyFrameTiming])

  // 静态画面（拍照结果或选中的照片）：设置变化时重新处理，长按对比时直接画原图。
  // 并发守卫（与相机模式的 processing 守卫同思路）：
  // a) rAF 合并同一帧内的连续 settings 变更（拖滑杆每个 tick 不会各起一条全流水线）；
  // b) 上一轮还在处理时只记 pending，结束后用最新设置补跑一轮（in-flight 串行化）；
  // c) generation 判过期：已有更新设置时，过期结果不渲染。
  useEffect(() => {
    const job = staticJobRef.current
    job.generation += 1
    const generation = job.generation
    if (!captured) return undefined
    const source = sourceCanvasRef.current
    if (!source) return undefined
    if (showOriginal) {
      cancelAnimationFrame(job.rafId)
      job.pending = false
      displayRef.current?.draw(source)
      return undefined
    }
    const launch = (gen) => {
      if (job.processing) {
        job.pending = true
        return
      }
      job.processing = true
      runBeauty(source, settingsRef.current, sourceVersionRef.current)
        .then((output) => {
          if (output && gen === job.generation && !job.pending) {
            displayRef.current?.draw(output)
          }
        })
        .finally(() => {
          job.processing = false
          if (job.pending) {
            job.pending = false
            // 补跑用最新 generation（读取最新 settings），过期轮次的结果不渲染
            job.rafId = requestAnimationFrame(() => launch(job.generation))
          }
        })
    }
    cancelAnimationFrame(job.rafId)
    job.rafId = requestAnimationFrame(() => launch(generation))
    return () => { cancelAnimationFrame(job.rafId) }
  }, [captured, settings, showOriginal, runBeauty])

  const handleCapture = () => {
    const video = videoRef.current
    const source = sourceCanvasRef.current
    if (!video || !source) return
    const width = video.videoWidth || FALLBACK_FRAME_SIZE.width
    const height = video.videoHeight || FALLBACK_FRAME_SIZE.height
    fitCanvas(source, width, height)
    const ctx = source.getContext('2d')
    if (ctx) ctx.drawImage(video, 0, 0, source.width, source.height)
    sourceVersionRef.current += 1 // 新源图：landmarks 缓存失效
    setCaptured(true)
  }

  const handlePhotoChange = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setPhotoError('只支持图片文件，请重新选择')
      return
    }
    setPhotoError('')
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current)
    const url = URL.createObjectURL(file)
    photoUrlRef.current = url
    setPhoto({ url, name: file.name })
  }

  const handlePhotoLoaded = (event) => {
    const img = event.currentTarget
    const source = sourceCanvasRef.current
    if (!source) return
    const width = img.naturalWidth || img.width || FALLBACK_FRAME_SIZE.width
    const height = img.naturalHeight || img.height || FALLBACK_FRAME_SIZE.height
    fitCanvas(source, width, height)
    const ctx = source.getContext('2d')
    if (ctx) ctx.drawImage(img, 0, 0, source.width, source.height)
    sourceVersionRef.current += 1 // 新源图：landmarks 缓存失效
    setCaptured(true)
  }

  const handleReset = () => {
    setCaptured(false)
    setShowOriginal(false)
    processedRef.current = null
    if (mode === 'photo') {
      if (photoUrlRef.current) {
        URL.revokeObjectURL(photoUrlRef.current)
        photoUrlRef.current = null
      }
      setPhoto(null)
    }
  }

  const handleSelectPreset = (preset) => {
    setActivePresetId(preset.id)
    setSettings({ ...preset.settings })
  }

  const handleSettingChange = (key, value) => {
    setActivePresetId('custom')
    setSettings(previous => ({ ...previous, [key]: value }))
  }

  // 挂载时拉取自定义妆容：失败只落提示，美颜主流程不受影响
  useEffect(() => {
    let alive = true
    makeupPresetService.list()
      .then((presets) => { if (alive) setCustomPresets(presets) })
      .catch(() => { if (alive) setPresetError('妆容预设加载失败，保存和点用暂时不可用') })
    return () => { alive = false }
  }, [])

  // 内置预设在前，自定义妆容按服务端顺序接在后；点用走同一个 handleSelectPreset
  const mergedPresets = [
    ...BEAUTY_PRESETS,
    ...customPresets.map(p => ({
      id: p.id,
      name: p.name,
      settings: { smooth: p.smooth, whiten: p.whiten, slim: p.slim, eye: p.eye },
    })),
  ]

  const handleSavePreset = async () => {
    const name = saveName.trim()
    if (!name) return
    try {
      const created = await makeupPresetService.create({ name, ...settings })
      setCustomPresets(previous => [...previous, created])
      setActivePresetId(created.id)
      setSaveDialogOpen(false)
      setSaveName('')
      setPresetError('')
    } catch (err) {
      setPresetError(err.response?.data?.error || '保存妆容失败，请重试')
    }
  }

  const handleRenamePreset = async () => {
    const name = renameName.trim()
    if (!renaming || !name) return
    try {
      const updated = await makeupPresetService.rename(renaming.id, { name })
      setCustomPresets(previous => previous.map(p => (p.id === updated.id ? updated : p)))
      setRenaming(null)
      setPresetError('')
    } catch (err) {
      setPresetError(err.response?.data?.error || '重命名失败，请重试')
    }
  }

  const handleDeletePreset = async () => {
    if (!deleting) return
    try {
      await makeupPresetService.remove(deleting.id)
      setCustomPresets(previous => previous.filter(p => p.id !== deleting.id))
      if (activePresetId === deleting.id) setActivePresetId('custom')
      setDeleting(null)
      setPresetError('')
    } catch (err) {
      setPresetError(err.response?.data?.error || '删除失败，请重试')
    }
  }

  const handleSave = () => {
    const canvas = showOriginal ? sourceCanvasRef.current : processedRef.current
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `妆容-${format(new Date(), 'yyyy-MM-dd-HHmm')}.png`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    }, 'image/png')
  }

  const showControls = captured || (mode === 'camera' && streaming)

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-transparent">
      <Header title="化妆间" showBack />
      <main className="flex-1 overflow-y-auto px-4 py-5">
        <section className="rounded-3xl bg-pastel-mist p-5 shadow-card">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-card text-status-info" aria-hidden="true">
              <ShieldCheck size={22} />
            </div>
            <div>
              <h1 className="text-base font-semibold text-text-primary">化妆间</h1>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                拍一张或选一张照片，实时调整磨皮、美白、瘦脸、大眼。调好的一组参数可以存成妆容，下次一点就用。
              </p>
              <span className="mt-3 inline-flex rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-status-local">
                全部处理都在这台设备上，照片不上传
              </span>
            </div>
          </div>
        </section>

        <div role="tablist" aria-label="取图方式" className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-surface-muted p-1">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'camera'}
            onClick={() => setMode('camera')}
            className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition-colors ${
              mode === 'camera' ? 'bg-surface-card text-action-primary shadow-card' : 'text-text-secondary'
            }`}
          >
            <Camera size={16} aria-hidden="true" />
            拍一张
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'photo'}
            onClick={() => setMode('photo')}
            className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition-colors ${
              mode === 'photo' ? 'bg-surface-card text-action-primary shadow-card' : 'text-text-secondary'
            }`}
          >
            <ImagePlus size={16} aria-hidden="true" />
            选照片
          </button>
        </div>

        {engineError && <p role="alert" className="mt-3 text-xs text-danger">{engineError}</p>}

        {mode === 'camera' && !captured && (
          <section aria-label="相机预览" className="mt-4">
            <video ref={videoRef} playsInline muted autoPlay className="sr-only" aria-hidden="true" />
            {cameraError ? (
              <div role="alert" className="rounded-3xl bg-surface-card p-5 text-sm leading-relaxed text-text-secondary shadow-card">
                {cameraError}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative overflow-hidden rounded-2xl bg-black">
                  <BeautyCanvas ref={displayRef} label={showOriginal ? '原图预览' : '美颜实时预览'} />
                  {!streaming && (
                    <p className="absolute inset-0 flex items-center justify-center text-sm text-text-inverse">
                      正在打开相机…
                    </p>
                  )}
                  {degraded && (
                    <p role="status" className="absolute bottom-2 left-2 rounded-full bg-black/60 px-3 py-1 text-xs text-text-inverse">
                      当前设备较慢，已自动降低画质保持流畅
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleCapture}
                  disabled={!streaming}
                  className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-action-primary hover:bg-action-hover text-sm font-semibold text-text-inverse shadow-card transition-transform active:scale-95 disabled:opacity-50"
                >
                  拍一张
                </button>
              </div>
            )}
          </section>
        )}

        {mode === 'photo' && !captured && (
          <section aria-label="选择照片" className="mt-4 rounded-3xl bg-surface-card p-5 shadow-card">
            <input ref={fileInputRef} type="file" accept="image/*" aria-label="选择照片" className="sr-only" onChange={handlePhotoChange} />
            {photo ? (
              <img
                src={photo.url}
                alt={`已选照片预览：${photo.name}`}
                onLoad={handlePhotoLoaded}
                className="max-h-64 w-full rounded-2xl object-contain"
              />
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border-default bg-surface-page text-sm text-text-secondary transition-colors hover:bg-pastel-mist"
              >
                <ImagePlus size={22} className="text-status-info" aria-hidden="true" />
                从这台设备选择一张照片
              </button>
            )}
            {photoError && <p role="alert" className="mt-2 text-xs text-danger">{photoError}</p>}
          </section>
        )}

        {captured && (
          <section aria-label="处理结果" className="mt-4">
            <BeautyCanvas ref={displayRef} label={showOriginal ? '原图' : '美颜效果'} />
          </section>
        )}

        {showControls && (
          <section aria-label="美颜调节" className="mt-4 rounded-3xl bg-surface-card p-5 shadow-card">
            <SliderPanel
              presets={mergedPresets}
              activePresetId={activePresetId}
              onSelectPreset={handleSelectPreset}
              settings={settings}
              onSettingChange={handleSettingChange}
            />

            <div className="mt-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-text-muted">我的妆容</h2>
                <button
                  type="button"
                  onClick={() => { setSaveName(''); setSaveDialogOpen(true) }}
                  className="min-h-11 rounded-2xl border border-border-default bg-surface-card px-4 text-xs font-semibold text-action-primary"
                >
                  把当前存为妆容
                </button>
              </div>
              {presetError && <p role="alert" className="mt-2 text-xs text-danger">{presetError}</p>}
              {customPresets.length > 0 && (
                <ul className="mt-2 space-y-2">
                  {customPresets.map(preset => (
                    <li key={preset.id} className="flex items-center gap-2 rounded-2xl border border-border-default bg-surface-card px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{preset.name}</span>
                      <button
                        type="button"
                        onClick={() => { setRenaming(preset); setRenameName(preset.name) }}
                        className="min-h-11 shrink-0 rounded-xl px-3 text-xs font-semibold text-text-secondary"
                      >
                        重命名
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(preset)}
                        className="min-h-11 shrink-0 rounded-xl px-3 text-xs font-semibold text-danger"
                      >
                        删除
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <CompareHoldButton onHoldChange={setShowOriginal} />
              {captured && (
                <button
                  type="button"
                  onClick={handleSave}
                  className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-action-primary hover:bg-action-hover text-sm font-semibold text-text-inverse shadow-card transition-transform active:scale-95"
                >
                  <Download size={16} aria-hidden="true" />
                  保存到相册
                </button>
              )}
            </div>
            {captured && (
              <button
                type="button"
                onClick={handleReset}
                className="mt-2 flex min-h-11 w-full items-center justify-center rounded-2xl border border-border-default bg-surface-card text-sm font-semibold text-text-secondary"
              >
                {mode === 'camera' ? '重拍一张' : '换一张照片'}
              </button>
            )}
          </section>
        )}

      <Modal open={saveDialogOpen} title="存为妆容">
        <input
          type="text"
          value={saveName}
          onChange={event => setSaveName(event.target.value)}
          maxLength={20}
          aria-label="妆容名字"
          placeholder="比如：日常淡妆"
          className="mt-4 min-h-11 w-full rounded-2xl border border-border-default bg-surface-input px-3 text-sm text-text-primary"
        />
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setSaveDialogOpen(false)}
            className="min-h-11 flex-1 rounded-2xl border border-border-default text-sm font-semibold text-text-secondary"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSavePreset}
            disabled={!saveName.trim()}
            className="min-h-11 flex-1 rounded-2xl bg-action-primary text-sm font-semibold text-text-inverse disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </Modal>

      <Modal open={renaming !== null} title="重命名妆容">
        <input
          type="text"
          value={renameName}
          onChange={event => setRenameName(event.target.value)}
          maxLength={20}
          aria-label="妆容名字"
          className="mt-4 min-h-11 w-full rounded-2xl border border-border-default bg-surface-input px-3 text-sm text-text-primary"
        />
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setRenaming(null)}
            className="min-h-11 flex-1 rounded-2xl border border-border-default text-sm font-semibold text-text-secondary"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleRenamePreset}
            disabled={!renameName.trim()}
            className="min-h-11 flex-1 rounded-2xl bg-action-primary text-sm font-semibold text-text-inverse disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="删除这个妆容"
        description={deleting ? `「${deleting.name}」删除后找不回来了，确定继续吗？` : ''}
        confirmLabel="删除"
        danger
        onConfirm={handleDeletePreset}
        onCancel={() => setDeleting(null)}
      />
      </main>
    </div>
  )
}
