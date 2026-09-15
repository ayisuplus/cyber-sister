import { useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, SlidersHorizontal } from 'lucide-react'
import Header from '../components/layout/Header'
import SliderPanel from '../components/beauty/SliderPanel'
import Modal from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import SourceBadge from '../components/ui/SourceBadge'
import { BEAUTY_PRESETS } from '../features/beauty/presets'
import { makeupPresetService } from '../services/makeupPresetService'
import { workMediaService } from '../services/workMediaService'
import { getSessionVersion, onSessionReset } from '../services/sessionLifecycle'
import useWorkMediaPreview from '../hooks/useWorkMediaPreview'

const buttonClass = 'min-h-11 rounded-2xl border border-border-default bg-surface-card px-4 text-sm font-semibold text-text-secondary'
const inputClass = 'mt-4 min-h-11 w-full rounded-2xl border border-border-default bg-surface-input px-3 text-sm text-text-primary'

// embedded：作为「装扮」页签嵌入时不渲染自己的页头
export default function MakeupRoomPage({ embedded = false } = {}) {
  const media = useWorkMediaPreview(workMediaService.previewMakeup)
  const [settings, setSettings] = useState({ ...BEAUTY_PRESETS.find(p => p.id === 'natural').settings })
  const [activePresetId, setActivePresetId] = useState('natural')
  const [customPresets, setCustomPresets] = useState([])
  const [presetError, setPresetError] = useState('')
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [renaming, setRenaming] = useState(null)
  const [renameName, setRenameName] = useState('')
  const [deleting, setDeleting] = useState(null)
  const [saving, setSaving] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const fileInputRef = useRef(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const cameraVersion = useRef(0)
  const alive = useRef(false)

  const stopCamera = () => {
    cameraVersion.current += 1
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraOpen(false)
    setCameraReady(false)
  }

  useEffect(() => {
    alive.current = true
    const session = getSessionVersion()
    makeupPresetService.list()
      .then(presets => { if (alive.current && session === getSessionVersion()) setCustomPresets(presets) })
      .catch(() => { if (alive.current && session === getSessionVersion()) setPresetError('妆容预设加载失败，请稍后重试') })
    const unsubscribe = onSessionReset(() => {
      stopCamera()
      setCustomPresets([])
      setSaveDialogOpen(false)
      setRenaming(null)
      setDeleting(null)
      setPresetError('')
      setSaving(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    })
    return () => {
      alive.current = false
      cameraVersion.current += 1
      streamRef.current?.getTracks().forEach(track => track.stop())
      unsubscribe()
    }
  }, [])

  const handlePhoto = file => {
    stopCamera()
    setCameraError('')
    media.setFile(file)
  }

  const openCamera = async () => {
    stopCamera()
    media.setFile(null)
    setCameraError('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('这台设备暂不支持相机，请选择照片')
      return
    }
    const version = cameraVersion.current
    setCameraOpen(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 } } })
      if (!alive.current || version !== cameraVersion.current) { stream.getTracks().forEach(track => track.stop()); return }
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch {
      if (alive.current && version === cameraVersion.current) {
        setCameraOpen(false)
        setCameraError('相机未能打开，请检查相机权限或改用选择照片')
      }
    }
  }

  const capture = () => {
    const video = videoRef.current
    if (!video?.videoWidth || !video.videoHeight) return
    const version = cameraVersion.current
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 1280 / video.videoWidth)
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    const context = canvas.getContext('2d')
    if (!context) { setCameraError('无法拍摄照片，请改用选择照片'); return }
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(blob => {
      if (!alive.current || version !== cameraVersion.current) return
      if (!blob) { setCameraError('拍照失败，请重试'); return }
      handlePhoto(new File([blob], 'camera.jpg', { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.9)
  }

  const mergedPresets = [...BEAUTY_PRESETS, ...customPresets.map(p => ({
    id: p.id, name: p.name, settings: { smooth: p.smooth, whiten: p.whiten, slim: p.slim, eye: p.eye },
  }))]

  const savePreset = async () => {
    const name = (renaming ? renameName : saveName).trim()
    if (!name || saving) return
    const session = getSessionVersion()
    setSaving(true)
    setPresetError('')
    try {
      const saved = renaming
        ? await makeupPresetService.rename(renaming.id, { name })
        : await makeupPresetService.create({ name, ...settings })
      if (!alive.current || session !== getSessionVersion()) return
      setCustomPresets(previous => renaming ? previous.map(p => p.id === saved.id ? saved : p) : [...previous, saved])
      if (!renaming) setActivePresetId(saved.id)
      setRenaming(null)
      setSaveDialogOpen(false)
    } catch (err) {
      if (alive.current && session === getSessionVersion()) setPresetError(err.response?.data?.error || '保存妆容失败，请重试')
    } finally {
      if (alive.current && session === getSessionVersion()) setSaving(false)
    }
  }

  const deletePreset = async () => {
    if (!deleting || saving) return
    const session = getSessionVersion()
    setSaving(true)
    setPresetError('')
    try {
      await makeupPresetService.remove(deleting.id)
      if (!alive.current || session !== getSessionVersion()) return
      setCustomPresets(previous => previous.filter(p => p.id !== deleting.id))
      if (activePresetId === deleting.id) setActivePresetId('custom')
      setDeleting(null)
      setPresetError('')
    } catch (err) {
      if (alive.current && session === getSessionVersion()) setPresetError(err.response?.data?.error || '删除失败，请重试')
    } finally {
      if (alive.current && session === getSessionVersion()) setSaving(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-transparent">
      {!embedded && <Header title="化妆间" showBack />}
      <main className="flex-1 overflow-y-auto px-4 py-5">
        <section className="rounded-3xl bg-pastel-mist p-5 shadow-card">
          <h1 className="flex items-center gap-2 text-base font-semibold text-text-primary"><SlidersHorizontal size={22} aria-hidden="true" />化妆间</h1>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">选好照片和妆容参数，再提交模拟预览。现在只校验请求，不生成美颜图片。</p>
          <p className="mt-2 text-xs leading-relaxed text-text-secondary">提交时原图会发送至应用后端，仅用于本次内存校验，不保存照片，不转发至云端供应商。</p>
        </section>

        <section aria-label="选择照片" className="mt-4 rounded-3xl bg-surface-card p-5 shadow-card">
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择照片" className="sr-only" onChange={event => { handlePhoto(event.target.files?.[0] || null); event.target.value = '' }} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${buttonClass} flex items-center gap-2`} onClick={() => fileInputRef.current?.click()}><ImagePlus size={16} aria-hidden="true" />{media.file ? '换一张照片' : '选择照片'}</button>
            <button type="button" className={`${buttonClass} flex items-center gap-2`} onClick={openCamera}><Camera size={16} aria-hidden="true" />打开相机</button>
          </div>
          <p className="mt-2 text-xs text-text-muted">PNG、JPEG 或 WebP，最大 8MB</p>
          {cameraOpen && <div className="mt-3 space-y-2">
            <video ref={videoRef} autoPlay playsInline muted aria-label="相机原始预览" onLoadedMetadata={() => setCameraReady(true)} className="max-h-80 w-full rounded-2xl bg-black object-contain" />
            <div className="flex gap-2"><button type="button" onClick={capture} disabled={!cameraReady} className={buttonClass}>拍一张</button><button type="button" onClick={stopCamera} className={buttonClass}>关闭相机</button></div>
          </div>}
          {cameraError && <p role="alert" className="mt-2 text-sm text-danger">{cameraError}</p>}
          {media.imageUrl && media.file && <figure className="mt-3"><img src={media.imageUrl} alt={`原图预览：${media.file.name}`} className="max-h-72 w-full rounded-2xl object-contain" /><figcaption className="mt-2 text-center text-xs text-text-secondary">原图 · 尚未生成美颜效果</figcaption></figure>}
        </section>

        <section aria-label="美颜调节" className="mt-4 rounded-3xl bg-surface-card p-5 shadow-card">
          <SliderPanel presets={mergedPresets} activePresetId={activePresetId} settings={settings}
            onSelectPreset={preset => { media.invalidate(); setActivePresetId(preset.id); setSettings({ ...preset.settings }) }}
            onSettingChange={(key, value) => { media.invalidate(); setActivePresetId('custom'); setSettings(previous => ({ ...previous, [key]: value })) }} />
          <p className="mt-3 text-xs text-text-secondary">滑杆用于填写云端请求参数，原图预览不会随参数变化。</p>
          <button type="button" onClick={() => media.submit({ ...settings })} disabled={!media.file || media.busy} className="mt-4 min-h-12 w-full rounded-2xl bg-action-primary px-4 text-sm font-semibold text-text-inverse disabled:opacity-50">{media.busy ? '正在模拟预览…' : '提交模拟预览'}</button>
          {media.error && <p role="alert" className="mt-2 text-sm text-danger">{media.error}</p>}
          {media.result && <div role="status" aria-label="模拟预览结果" className="mt-3 rounded-2xl bg-pastel-apricot p-4"><SourceBadge source={media.result.source} /><p className="mt-2 text-sm leading-relaxed text-text-primary">{media.result.result.message}</p><p className="mt-2 text-xs text-text-secondary">当前没有可查看或下载的生成图片。</p></div>}
          <div className="mt-5 flex items-center justify-between gap-2"><h2 className="text-sm font-semibold text-text-primary">我的妆容</h2><button type="button" onClick={() => { setSaveName(''); setPresetError(''); setSaveDialogOpen(true) }} className={buttonClass}>把当前存为妆容</button></div>
          {presetError && !saveDialogOpen && !renaming && !deleting && <p role="alert" className="mt-2 text-sm text-danger">{presetError}</p>}
          {customPresets.length > 0 && <ul className="mt-2 space-y-2">{customPresets.map(preset => <li key={preset.id} className="flex items-center gap-2 rounded-2xl border border-border-default px-3 py-2"><span className="min-w-0 flex-1 truncate text-sm text-text-primary">{preset.name}</span><button type="button" onClick={() => { setRenaming(preset); setRenameName(preset.name); setPresetError('') }} className="min-h-11 px-2 text-xs font-semibold text-text-secondary">重命名</button><button type="button" onClick={() => { setPresetError(''); setDeleting(preset) }} className="min-h-11 px-2 text-xs font-semibold text-danger">删除</button></li>)}</ul>}
        </section>
      </main>
      <Modal open={saveDialogOpen || renaming !== null} title={renaming ? '重命名妆容' : '存为妆容'}>
        <input type="text" value={renaming ? renameName : saveName} onChange={event => renaming ? setRenameName(event.target.value) : setSaveName(event.target.value)} maxLength={20} aria-label="妆容名字" className={inputClass} />
        {presetError && <p role="alert" className="mt-2 text-sm text-danger">{presetError}</p>}
        <div className="mt-4 flex gap-2"><button type="button" onClick={() => { setRenaming(null); setSaveDialogOpen(false) }} className={`${buttonClass} flex-1`}>取消</button><button type="button" onClick={savePreset} disabled={saving || !(renaming ? renameName : saveName).trim()} className="min-h-11 flex-1 rounded-2xl bg-action-primary text-sm font-semibold text-text-inverse disabled:opacity-50">{saving ? '保存中…' : '保存'}</button></div>
      </Modal>
      <ConfirmDialog open={deleting !== null} title="删除这个妆容" description={deleting ? `「${deleting.name}」删除后找不回来了，确定继续吗？` : ''} confirmLabel="删除" danger busy={saving} error={presetError} onConfirm={deletePreset} onCancel={() => setDeleting(null)} />
    </div>
  )
}
