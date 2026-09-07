import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Sparkles, WandSparkles } from 'lucide-react'
import { virtualStudioService } from '../../services/virtualStudioService'

function missingSelectionReason(photo, selectedItem, itemNoun) {
  if (!photo) return '先在第一步选择一张照片'
  if (!selectedItem) return `再在第二步选择一款${itemNoun}`
  return ''
}

// 服务端带 IMAGE_GEN_* 错误码的回复原文展示（诚实接缝）；其余失败给温和通用文案
function honestFailureMessage(requestError) {
  const data = requestError.response?.data
  if (typeof data?.code === 'string' && data.code.startsWith('IMAGE_GEN')) {
    return data.error || '生图能力接入中，暂未开放'
  }
  return '这次请求没有成功，请稍后重试'
}

function submitLabel(submitting, hasResult) {
  if (submitting) return '正在生成（约十几秒）…'
  return hasResult ? '重新生成' : '生成预览'
}

// 能力状态卡：可用/不可用都如实说明，附当前选择摘要与手动重检
function StatusCard({ status, itemNoun, photoName, selectedItem, onRecheck }) {
  return (
    <div className="rounded-2xl bg-pastel-mist px-4 py-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-status-info">
        <Sparkles size={13} aria-hidden="true" />
        {status.available ? '生图能力已就绪' : '生图能力接入中'}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">
        {status.available
          ? `照片和所选${itemNoun}只发送到本机 ComfyUI 生成预览，不出这台设备。`
          : `本机 ComfyUI 生图服务在线后，这里会基于你的照片和所选${itemNoun}生成预览图；当前先确认你的选择。`}
      </p>
      <dl className="mt-2 space-y-1 text-[11px] text-text-secondary">
        <div className="flex gap-2">
          <dt className="shrink-0 text-text-muted">已选照片</dt>
          <dd className="truncate">{photoName || '未选择'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-text-muted">已选{itemNoun}</dt>
          <dd className="truncate">{selectedItem?.name || '未选择'}</dd>
        </div>
      </dl>
      <button type="button" onClick={onRecheck} className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border-default bg-surface-card px-4 text-xs font-semibold text-status-info">
        <RefreshCw size={14} aria-hidden="true" />
        重新检查
      </button>
    </div>
  )
}

function ResultPreview({ image, itemName, itemNoun }) {
  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface-page">
        <img src={image} alt={`${itemName || itemNoun}生成预览`} className="w-full object-contain" />
      </div>
      <a
        href={image}
        download="赛博姐妹预览.png"
        className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border-default bg-surface-card text-sm font-semibold text-status-info"
      >
        保存预览
      </a>
    </div>
  )
}

// 生成区：进入页面即检查生图能力状态；可用时真实提交本机 ComfyUI 生成并渲染结果，
// 不可用时保持「接入中」诚实占位，绝不渲染假结果图。
export default function GeneratePanel({ scene, photo, selectedItem, itemNoun }) {
  const [status, setStatus] = useState(null)
  const [phase, setPhase] = useState('loading')
  const [submitting, setSubmitting] = useState(false)
  const [submitMessage, setSubmitMessage] = useState('')
  const [resultImage, setResultImage] = useState(null)

  const loadStatus = useCallback(async () => {
    setPhase('loading')
    try {
      const next = await virtualStudioService.getImageGenStatus()
      setStatus(next)
      setPhase('ready')
    } catch {
      setStatus(null)
      setPhase('error')
    }
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])

  // 换照片或换条目后，旧结果作废，避免张冠李戴
  useEffect(() => {
    setResultImage(null)
    setSubmitMessage('')
  }, [photo, selectedItem])

  const missingReason = missingSelectionReason(photo, selectedItem, itemNoun)

  const handleGenerate = async () => {
    if (missingReason || submitting) return
    setSubmitting(true)
    setSubmitMessage('')
    try {
      const result = await virtualStudioService.requestGeneration({
        scene,
        itemId: selectedItem.id,
        photo: photo.file,
      })
      setResultImage(result.imageDataUrl)
    } catch (requestError) {
      setSubmitMessage(honestFailureMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-4 space-y-3">
      {phase === 'loading' && (
        <p className="text-xs text-text-muted">正在检查生图能力状态…</p>
      )}

      {phase === 'error' && (
        <div className="rounded-2xl bg-pastel-apricot px-4 py-3">
          <p className="text-xs leading-relaxed text-text-secondary">没能连上能力检查接口，请检查网络后重试。</p>
          <button type="button" onClick={loadStatus} className="mt-2 flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border-default bg-surface-card px-4 text-xs font-semibold text-status-info">
            <RefreshCw size={14} aria-hidden="true" />
            重新检查
          </button>
        </div>
      )}

      {phase === 'ready' && status && (
        <StatusCard status={status} itemNoun={itemNoun} photoName={photo?.name} selectedItem={selectedItem} onRecheck={loadStatus} />
      )}

      <button
        type="button"
        disabled={Boolean(missingReason) || submitting}
        onClick={handleGenerate}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-action-primary text-sm font-semibold text-text-inverse shadow-card disabled:opacity-50"
      >
        {submitting ? <RefreshCw size={16} className="animate-spin" aria-hidden="true" /> : <WandSparkles size={16} aria-hidden="true" />}
        {submitLabel(submitting, Boolean(resultImage))}
      </button>
      {missingReason && <p className="text-center text-[11px] text-text-muted">{missingReason}</p>}

      {resultImage && <ResultPreview image={resultImage} itemName={selectedItem?.name} itemNoun={itemNoun} />}

      {submitMessage && (
        <p role="status" className="rounded-2xl bg-pastel-apricot px-3 py-2 text-center text-[11px] leading-relaxed text-text-secondary">{submitMessage}</p>
      )}
    </div>
  )
}
