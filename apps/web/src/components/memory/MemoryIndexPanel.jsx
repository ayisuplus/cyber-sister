import { useEffect, useState } from 'react'
import { memoryService } from '../../services/memoryService'

const STATUS = { queued: '等待处理', running: '正在处理', completed: '处理结束', cancelled: '已取消', interrupted: '服务重启，任务已中断', failed: '任务失败，可重试' }
const active = (job) => ['queued', 'running'].includes(job?.status)

export default function MemoryIndexPanel() {
  const [job, setJob] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    memoryService.latestIndexJob().then((result) => { if (alive) setJob((current) => current ?? result) }).catch(() => { if (alive) setError('索引状态读取失败') })
    return () => { alive = false }
  }, [])
  useEffect(() => {
    if (!active(job)) return undefined
    let alive = true
    const timer = setTimeout(() => {
      memoryService.indexJob(job.id).then((result) => { if (alive) { setJob(result); setError('') } })
        .catch(() => { if (alive) setError('进度读取失败，可刷新状态后继续查看') })
    }, 1000)
    return () => { alive = false; clearTimeout(timer) }
  }, [job])
  const act = async (operation) => {
    if (busy) return
    setBusy(true); setError('')
    try { setJob(await operation()) }
    catch (failure) { setError(failure?.response?.data?.error || '索引操作失败，请重试') }
    finally { setBusy(false) }
  }
  return <details className="rounded-card border border-border-subtle bg-surface-card p-4">
    <summary className="min-h-11 cursor-pointer text-sm font-semibold text-text-primary">记忆检索维护</summary>
    <p className="mb-3 text-xs leading-relaxed text-text-secondary">配置并允许向量服务后，可以把已确认记忆交给云端生成检索索引。向量暂不可用时，聊天仍可使用关键词检索。</p>
    {job && <p role="status" className="mb-2 text-xs text-text-primary">{STATUS[job.status]} · 已处理 {job.processed}/{job.total} · 成功 {job.embedded} · 跳过 {job.skipped} · 失败 {job.failed}</p>}
    <div className="flex flex-wrap gap-2">
      {['repair', 'rebuild'].map((mode) => <button key={mode} type="button" disabled={busy || active(job)} className="min-h-11 rounded-xl border border-border-subtle px-3 text-xs text-text-primary disabled:opacity-40" onClick={() => act(() => memoryService.createIndexJob(mode))}>{mode === 'repair' ? '修复缺失或过期索引' : '全部重新生成'}</button>)}
      {active(job) && <button type="button" disabled={busy} className="min-h-11 px-3 text-xs text-danger" onClick={() => act(() => memoryService.cancelIndexJob(job.id))}>取消任务</button>}
      <button type="button" disabled={busy} className="min-h-11 px-3 text-xs text-text-secondary" onClick={() => act(() => memoryService.latestIndexJob())}>刷新状态</button>
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
  </details>
}
