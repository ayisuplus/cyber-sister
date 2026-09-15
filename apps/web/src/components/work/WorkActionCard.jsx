import { useState } from 'react'

const LABELS = { approved: '已确认，等待提交', executing: '正在提交', completed: '已收到网站响应', rejected: '已选择不提交', expired: '确认已过期，未提交', cancelled: '已取消，未提交', uncertain: '提交结果需要核对，请勿重复提交' }

function bodyPreview(action) {
  if (/^application\/x-www-form-urlencoded/i.test(action.contentType)) {
    return [...new URLSearchParams(action.body)].map(([name, value]) => `${name}: ${value}`).join('\n')
  }
  return action.body
}

export default function WorkActionCard({ taskId, action, decide }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = action.status === 'pending'
  const imageGeneration = action.provider === 'runninghub'
  const expired = new Date(action.expiresAt).getTime() <= Date.now()
  const preview = bodyPreview(action)
  const submit = async decision => {
    if (busy) return
    setBusy(true); setError('')
    try { await decide(taskId, action.id, decision) }
    catch (requestError) { setError(requestError.response?.data?.error || '确认未保存，请核对后重试') }
    finally { setBusy(false) }
  }
  return <section aria-label="外部提交确认" className="mt-3 rounded-xl border border-border-default bg-surface-card p-3 text-sm">
    <p className="font-medium text-text-primary">{pending ? '这一步需要你确认' : imageGeneration && action.providerTaskId ? '云端任务已提交' : LABELS[action.status] || '提交状态待核对'}</p>
    <p className="mt-1 text-text-secondary [overflow-wrap:anywhere]">{action.purpose}</p>
    <p className="mt-2 break-all text-xs text-text-secondary">将发送到：{action.url}</p>
    <p className="mt-1 text-xs text-text-muted">{action.method}{action.httpStatus ? ` · 网站响应 ${action.httpStatus}` : ''}</p>
    {imageGeneration && <p className="mt-2 text-xs text-text-secondary">付费生成 1 张图片，按 RunningHub API 实际用量计费，当前没有金额硬上限。确认后会上传提示词及所选参考图；取消本地任务不保证云端停止或退款。</p>}
    {imageGeneration && action.providerTaskId && <p className="mt-2 break-all text-xs text-text-secondary">云端编号：{action.providerTaskId}。如未收到图片，在本会话发送“取回上次生成的图片”，无需重新生图。</p>}
    {pending && <>
      <p className="mt-2 text-xs text-text-secondary">发送内容</p>
      <pre className="mt-1 max-h-52 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-input p-2 text-xs text-text-primary [overflow-wrap:anywhere]">{preview || '无正文；请核对网址中携带的内容。'}</pre>
      {preview !== action.body && <details className="mt-2 text-xs text-text-secondary">
        <summary className="cursor-pointer">查看请求原文</summary>
        <pre className="mt-1 max-h-52 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere]">{action.body}</pre>
      </details>}
      <p className="mt-2 text-xs text-text-muted">只确认上面这一次请求。{expired ? '确认已过期。' : '确认前不会发送。'}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={busy || expired} onClick={() => submit('approve')} className="min-h-11 rounded-lg bg-action-primary px-3 text-xs text-text-inverse disabled:opacity-50">{imageGeneration ? '确认付费生成一次' : '确认提交一次'}</button>
        <button type="button" disabled={busy || expired} onClick={() => submit('reject')} className="min-h-11 rounded-lg px-3 text-xs text-text-secondary disabled:opacity-50">不提交</button>
      </div>
    </>}
    {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
  </section>
}
