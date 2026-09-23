import { useState } from 'react'
import { useChatStore } from '../../stores/chatStore'
import WorkProgress from './WorkProgress'
import WorkActionCard from './WorkActionCard'

const LABELS = { queued: '排队中', running: '正在处理', completed: '已完成', failed: '未完成', cancelled: '已取消', paused: '需要核对' }
const ERRORS = {
  CLOUD_NOT_CONSENTED: '请先在设置中同意云端处理，再重试。',
  LLM_UNAVAILABLE: '模型暂时不可用，可以稍后继续。',
  CONVERSATION_ARCHIVED: '请先恢复已归档的对话。',
  WORK_TASK_TIMEOUT: '本次执行达到时限，可以从保存的步骤继续。',
  WORK_TASK_UNCERTAIN: '服务中断时有一步操作需要核对。请先核对下方记录；生图已有云端编号时，在本会话取回原图，不要重复生成。结果未知时先核对供应商账单。取消此任务后可提交新任务。',
}

export default function WorkTaskPanel({ tasks, cancel, retry, decide }) {
  const [busy, setBusy] = useState(null)
  if (!tasks.length) return null
  const active = tasks.filter((task) => ['queued', 'running', 'paused'].includes(task.status)).length
  const act = async (id, action) => {
    if (busy) return
    setBusy(id)
    try { await action(id) } finally { setBusy(null) }
  }
  return <details open={active > 0 ? true : undefined} className="rounded-2xl border border-border-subtle bg-surface-card px-3 py-2 shadow-card">
    <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-text-primary">后台任务{active > 0 ? ` · ${active} 项进行中` : ` · 最近 ${tasks.length} 项`}</summary>
    <p className="mb-3 text-xs text-text-muted">提交后可离开页面，回来查看进度和结果。取消会停止后续步骤。</p>
    <ul aria-label="后台任务列表" className="max-h-96 space-y-3 overflow-y-auto">
      {tasks.map((task) => <li key={task.id} className="rounded-xl bg-surface-input p-3">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-sm text-text-primary [overflow-wrap:anywhere]">{task.content?.slice(0, 120) || '处理上传文件'}</p>
          <span className="shrink-0 text-xs text-text-secondary">{task.actions?.some(action => action.status === 'pending') ? '等待你确认' : LABELS[task.status] || '状态待更新'}</span>
        </div>
        {['queued', 'running'].includes(task.status) && <WorkProgress progress={task.progress} />}
        {task.actions?.map(action => <WorkActionCard key={action.id} taskId={task.id} action={action} decide={decide} />)}
        {['failed', 'paused'].includes(task.status) && <p className="mt-2 text-xs text-danger">{ERRORS[task.errorCode] || '执行暂时中断，已完成步骤已保存，可以重试。'}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          {task.status === 'completed' && <button type="button" className="min-h-11 rounded-lg bg-surface-card px-3 text-xs text-action-primary" onClick={() => useChatStore.getState().refreshThread()}>查看结果</button>}
          {task.status === 'failed' && <button type="button" disabled={busy === task.id} className="min-h-11 rounded-lg bg-surface-card px-3 text-xs text-action-primary" onClick={() => act(task.id, retry)}>从保存步骤继续</button>}
          {['queued', 'running', 'paused', 'failed'].includes(task.status) && <button type="button" disabled={busy === task.id} className="min-h-11 rounded-lg px-3 text-xs text-text-secondary" onClick={() => act(task.id, cancel)}>取消任务</button>}
        </div>
      </li>)}
    </ul>
  </details>
}
