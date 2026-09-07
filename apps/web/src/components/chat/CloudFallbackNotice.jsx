import { useState } from 'react'
import { Cloud } from 'lucide-react'
import { consentService } from '../../services/consentService'

export const CLOUD_FALLBACK_DISMISSED_KEY = 'cloudFallbackDismissed'

const TITLE_BY_STATE = {
  not_configured: '本地模型还没配置',
  loading: '本地模型还在加载',
  unavailable: '本地模型暂时不可用',
}

export default function CloudFallbackNotice({ localState, onClose, primary = false }) {
  const [pendingChoice, setPendingChoice] = useState(null)
  const [error, setError] = useState('')

  const decide = async (accepted) => {
    setError('')
    setPendingChoice(accepted ? 'cloud' : 'local')
    try {
      await consentService.update(accepted)
      onClose?.()
    } catch {
      setError('设置没有保存成功，请重试。')
    } finally {
      setPendingChoice(null)
    }
  }

  const dismissForSession = () => {
    sessionStorage.setItem(CLOUD_FALLBACK_DISMISSED_KEY, 'true')
    onClose?.()
  }

  return (
    <section aria-labelledby="cloud-fallback-title" className="mx-4 mt-3 rounded-[20px] bg-surface-card p-4 shadow-card">
      <h2 id="cloud-fallback-title" className="flex items-center gap-2 text-sm font-semibold text-text-primary">
        <Cloud size={16} className="text-status-info" aria-hidden="true" />
        {primary ? '这个姐妹住在云端' : (TITLE_BY_STATE[localState] || '本地模型暂时不可用')}
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-text-secondary">
        {primary
          ? '本内测部署的聊天由经批准的云端模型提供。同意后，聊天内容（经脱敏）会发送给外部模型供应商处理；不同意暂时无法聊天。你随时可以在「我的」页面改主意。'
          : '可以临时改用云端备用模型继续聊。要跟你说清楚：开启后聊天内容会发送给外部模型供应商（经脱敏）。你随时可以在「我的」页面改主意。'}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={pendingChoice !== null}
          onClick={() => decide(false)}
          className="min-h-11 rounded-xl border border-border-subtle text-xs font-semibold text-text-secondary disabled:opacity-50"
        >
          {primary ? '暂不同意' : '只用本地'}
        </button>
        <button
          type="button"
          disabled={pendingChoice !== null}
          onClick={() => decide(true)}
          className="min-h-11 rounded-xl bg-action-primary text-xs font-semibold text-text-inverse disabled:opacity-50"
        >
          {primary ? '同意并开始聊天' : '允许云端备用'}
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p aria-live="polite" className="flex-1 text-xs text-danger">{error}</p>
        <button
          type="button"
          onClick={dismissForSession}
          className="min-h-11 shrink-0 px-2 text-xs text-text-muted hover:text-text-secondary"
        >
          暂不
        </button>
      </div>
    </section>
  )
}
