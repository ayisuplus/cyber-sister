import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Sparkles, WandSparkles } from 'lucide-react'
import { virtualStudioService } from '../../services/virtualStudioService'

// 生成区：进入页面即检查生图能力状态；本期恒为「接入中」诚实占位，绝不渲染假结果图。
export default function GeneratePanel({ scene, photoName, selectedItem, itemNoun }) {
  const [status, setStatus] = useState(null)
  const [phase, setPhase] = useState('loading')
  const [submitting, setSubmitting] = useState(false)
  const [submitMessage, setSubmitMessage] = useState('')

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

  const missingReason = !photoName ? '先在第一步选择一张照片' : !selectedItem ? `再在第二步选择一款${itemNoun}` : ''

  const handleGenerate = async () => {
    if (missingReason || submitting) return
    setSubmitting(true)
    setSubmitMessage('')
    try {
      await virtualStudioService.requestGeneration({ scene, itemId: selectedItem.id })
      // 本期契约下成功路径不可达；若未来接通，这里替换为真实结果渲染
      setSubmitMessage('生图能力接入中，暂未开放')
    } catch (requestError) {
      const data = requestError.response?.data
      setSubmitMessage(data?.code === 'IMAGE_GEN_NOT_CONFIGURED'
        ? data.error || '生图能力接入中，暂未开放'
        : '这次请求没有成功，请稍后重试')
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
        <div className="rounded-2xl bg-pastel-mist px-4 py-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-status-info">
            <Sparkles size={13} aria-hidden="true" />
            {status.available ? '生图能力已就绪' : '生图能力接入中'}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">
            外部生图 API 接通后，这里会基于你的照片和所选{itemNoun}生成预览图；当前先确认你的选择。
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
          <button type="button" onClick={loadStatus} className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border-default bg-surface-card px-4 text-xs font-semibold text-status-info">
            <RefreshCw size={14} aria-hidden="true" />
            重新检查
          </button>
        </div>
      )}

      <button
        type="button"
        disabled={Boolean(missingReason) || submitting}
        onClick={handleGenerate}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-action-primary text-sm font-semibold text-text-inverse shadow-card disabled:opacity-50"
      >
        {submitting ? <RefreshCw size={16} className="animate-spin" aria-hidden="true" /> : <WandSparkles size={16} aria-hidden="true" />}
        生成预览
      </button>
      {missingReason && <p className="text-center text-[11px] text-text-muted">{missingReason}</p>}
      {submitMessage && (
        <p role="status" className="rounded-2xl bg-pastel-apricot px-3 py-2 text-center text-[11px] leading-relaxed text-text-secondary">{submitMessage}</p>
      )}
    </div>
  )
}
