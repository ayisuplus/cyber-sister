import { useState } from 'react'
import { Cloud } from 'lucide-react'
import { consentService } from '../../services/consentService'

export const CLOUD_FALLBACK_DISMISSED_KEY = 'cloudFallbackDismissed'

// 云端切割（2026-09-07）后这是 100% 用户的首屏同意门：
// 聊天只有一条云端路径，未同意前云端调用次数为零。
export default function CloudFallbackNotice({ onClose }) {
  const [pendingChoice, setPendingChoice] = useState(null)
  const [error, setError] = useState('')

  const decide = async (accepted) => {
    setError('')
    setPendingChoice(accepted ? 'cloud' : 'none')
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
        这个姐妹住在云端
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-text-secondary">
        聊天由经批准的云端模型提供。同意后，聊天内容（经脱敏：手机号、邮箱、证件号会被替换）会发送给外部模型供应商处理；不同意暂时无法聊天。你随时可以在「我的」页面改主意。
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={pendingChoice !== null}
          onClick={() => decide(false)}
          className="min-h-11 rounded-xl border border-border-subtle text-xs font-semibold text-text-secondary disabled:opacity-50"
        >
          暂不同意
        </button>
        <button
          type="button"
          disabled={pendingChoice !== null}
          onClick={() => decide(true)}
          className="min-h-11 rounded-xl bg-action-primary text-xs font-semibold text-text-inverse disabled:opacity-50"
        >
          同意并开始聊天
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
