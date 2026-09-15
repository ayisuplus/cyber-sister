import { useEffect, useState } from 'react'
import { companionService } from '../../services/companionService'
import Card from '../ui/Card'

const MODES = { open: '自然交流', guarded: '放慢节奏', withdrawn: '简短交流', sealed: '等待恢复' }

export default function CompanionStatePanel() {
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let active = true
    companionService.get().then((value) => { if (active) setSnapshot(value) })
      .catch(() => { if (active) setError('暂时无法读取角色状态。') })
    return () => { active = false }
  }, [])

  const recover = async () => {
    if (!snapshot || saving) return
    setSaving(true)
    setError('')
    try { setSnapshot(await companionService.recover(snapshot.revision)) }
    catch (failure) {
      if (failure.response?.status === 409) {
        setError('刚刚有新的对话完成，已刷新状态，请再操作一次。')
        try { setSnapshot(await companionService.get()) }
        catch { setError('状态刷新失败，请重新打开设置。') }
      } else setError('恢复失败，请重试。')
    } finally { setSaving(false) }
  }

  const state = snapshot?.state
  return (
    <Card className="p-4" aria-label="她的状态">
      <h3 className="text-sm font-semibold text-text-primary">她的状态</h3>
      <p className="mt-1 text-xs text-text-muted">角色运行模拟，随已完成的对话逐步更新。</p>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      {!state && !error && <p role="status" className="mt-3 text-sm text-text-muted">正在读取…</p>}
      {state && <>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-text-muted">交流节奏</dt><dd className="mt-1 text-text-primary">{MODES[state.protection.mode] || '状态待更新'}</dd></div>
          <div><dt className="text-text-muted">已纳入的经历</dt><dd className="mt-1 text-text-primary">{state.experienceCount} 次</dd></div>
          <div><dt className="text-text-muted">表达倾向</dt><dd className="mt-1 text-text-primary">{state.learning.brevity > 0.6 ? '偏简洁' : state.learning.brevity < 0.4 ? '偏详细' : '适中'}</dd></div>
          <div><dt className="text-text-muted">学习依据</dt><dd className="mt-1 text-text-primary">{state.learning.samples} 次明确反馈或工具结果</dd></div>
        </dl>
        <button type="button" disabled={saving} onClick={recover} className="mt-4 min-h-11 rounded-control border border-border-default px-3 text-sm text-text-primary disabled:opacity-50">
          {saving ? '正在恢复…' : '恢复平稳节奏'}
        </button>
        <p className="mt-2 text-xs text-text-muted">恢复后保留已学习的表达习惯和记忆。</p>
      </>}
    </Card>
  )
}
