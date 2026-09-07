import { useEffect, useRef, useState } from 'react'
import { ImagePlus, ShieldCheck } from 'lucide-react'

const MAX_PHOTO_BYTES = 8 * 1024 * 1024

// 隐私合同：照片在本机用 ObjectURL 预览；仅在用户点击生成时随请求发送到本机 API
// （同机转发给本地 ComfyUI 生图），不出这台设备、不落库。
export default function PhotoIntake({ onPhotoChange }) {
  const inputRef = useRef(null)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')

  // 换图时释放旧 ObjectURL，卸载时释放当前 ObjectURL
  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url)
    }
  }, [preview])

  const handleChange = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('只支持图片文件，请重新选择')
      return
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError('照片不能超过 8MB，请换一张小一点的')
      return
    }
    setError('')
    setPreview({ url: URL.createObjectURL(file), name: file.name })
    onPhotoChange({ name: file.name, file })
  }

  const clearPhoto = () => {
    setError('')
    setPreview(null)
    onPhotoChange(null)
  }

  const openPicker = () => inputRef.current?.click()

  return (
    <div className="mt-4">
      <input ref={inputRef} type="file" accept="image/*" aria-label="选择照片" className="sr-only" onChange={handleChange} />
      {preview ? (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface-page">
            <img src={preview.url} alt={`已选照片预览：${preview.name}`} className="max-h-64 w-full object-contain" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={openPicker} className="flex min-h-11 items-center justify-center rounded-2xl border border-border-default bg-surface-card text-sm font-semibold text-status-info">
              换一张
            </button>
            <button type="button" onClick={clearPhoto} className="flex min-h-11 items-center justify-center rounded-2xl border border-border-default bg-surface-card text-sm font-semibold text-text-secondary">
              移除照片
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={openPicker} className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border-default bg-surface-page text-sm text-text-secondary transition-colors hover:bg-pastel-mist">
          <ImagePlus size={22} className="text-status-info" aria-hidden="true" />
          从这台设备选择一张照片
        </button>
      )}
      <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-status-local">
        <ShieldCheck size={13} aria-hidden="true" />
        照片只在本机处理（本地 ComfyUI 生图），不出这台设备
      </p>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}
