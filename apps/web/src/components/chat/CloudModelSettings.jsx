import { useCallback, useEffect, useRef, useState } from 'react'
import { Cloud, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react'
import { modelStatusService } from '../../services/modelStatusService'
import { consentService } from '../../services/consentService'

export default function CloudModelSettings() {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const requestVersion = useRef(0)

  const refresh = useCallback(async () => {
    const request = ++requestVersion.current
    setBusy(true)
    setError('')
    try {
      const result = await modelStatusService.getStatus()
      if (request === requestVersion.current) setStatus({ ...result.externalFallback, embedding: result.embedding, workGeneration: result.workGeneration })
    } catch {
      if (request === requestVersion.current) setError('模型状态读取失败，请重试。')
    } finally {
      if (request === requestVersion.current) setBusy(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    return () => { requestVersion.current += 1 }
  }, [refresh])

  const toggleConsent = async () => {
    if (busy || !status) return
    const request = ++requestVersion.current
    setBusy(true)
    setError('')
    try {
      const result = await consentService.update(status.consent !== true)
      if (request === requestVersion.current) setStatus(previous => ({ ...previous, consent: result.accepted }))
    } catch {
      if (request === requestVersion.current) setError('云端模型设置保存失败，原来的选择已保留，请重试。')
    } finally {
      if (request === requestVersion.current) setBusy(false)
    }
  }

  const stateLabel = !status ? '正在读取配置' : !status.configured ? '尚未配置' : status.consent === true ? '已配置 · 已允许聊天' : '已配置 · 等待你的同意'

  return (
    <section aria-labelledby="cloud-settings-title" className="overflow-hidden rounded-card border border-border-hairline bg-surface-card shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <h2 id="cloud-settings-title" className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Cloud size={17} className="text-status-info" aria-hidden="true" />聊天模型</h2>
        <button type="button" disabled={busy} onClick={refresh} className="flex min-h-11 items-center gap-1.5 text-xs text-action-primary disabled:opacity-50"><RefreshCw size={14} aria-hidden="true" />刷新状态</button>
      </div>
      <div className="space-y-4 p-4">
        <div>
          <p role="status" className="text-sm font-semibold text-text-primary">{error && !status ? '状态暂时无法读取' : stateLabel}</p>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">{status?.configured ? '服务器已加载模型配置。实际可用性以聊天响应为准。' : '聊天服务需要加载模型地址、模型名称与密钥。配置就绪后可在这里刷新。'}</p>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-text-primary">允许云端模型处理聊天</span>
          <button type="button" role="switch" aria-label="允许云端模型处理聊天" aria-checked={status?.consent === true} disabled={busy || !status} onClick={toggleConsent} className="flex h-11 w-11 shrink-0 items-center justify-center disabled:opacity-40">
            {status?.consent === true ? <ToggleRight size={26} className="text-brand-pink" aria-hidden="true" /> : <ToggleLeft size={26} className="text-text-muted" aria-hidden="true" />}
          </button>
        </div>
        {/* 唯一的云端授权处（原「我的 → 云端模型」已并入）：外发范围说明两处合并，只增不减 */}
        <p className="text-xs leading-relaxed text-text-secondary">聊天会把脱敏后的消息、最多 5 条已确认的相关记忆及其已确认关联、你主动发送的照片交给已配置的聊天模型。语义检索使用单独配置的向量服务，开启后会发送记忆正文和检索文本；未配置时使用关键词检索。待确认草稿不会进入聊天。拒绝或撤回后聊天不可用，也会暂停向量生成，已有记录仍保留。日记与读书的回应、装扮预览目前仅提供模拟结果。</p>
        {status?.version && <p className="text-xs text-text-muted">同意版本：{status.version}</p>}
        {status?.embedding && <p className="text-xs text-text-secondary">记忆检索：{status.embedding.configured ? `向量模型 ${status.embedding.model} 已配置，实际可用性以任务结果为准` : '使用关键词检索，向量服务尚未配置'}</p>}
        <p className="text-xs text-text-secondary">工作台整理：模拟预览，尚未生成真实理解。</p>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </section>
  )
}
