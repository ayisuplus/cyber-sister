import { useEffect, useState } from 'react'
import { companionService } from '../../services/companionService'

// 只写真的在变的：节奏不平常时才说、才给「恢复」；学到长短偏向时才说。不显示信任，也不做成亲密度或计数。
const PACE = { guarded: '这会儿她放慢了节奏。', withdrawn: '这会儿她说得很简短。', sealed: '她在等恢复。' }

function lengthNote(learning) {
  if (!learning?.samples) return null
  if (learning.brevity > 0.6) return '你说过喜欢简短一些，她记着。'
  if (learning.brevity < 0.4) return '你说过想听详细一些，她记着。'
  return null
}

export default function CompanionStatePanel() {
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let active = true
    companionService.get().then((value) => { if (active) setSnapshot(value) })
      .catch(() => { if (active) setError('暂时无法读取她的状态。') })
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
        catch { setError('状态刷新失败，请重新打开这一页。') }
      } else setError('恢复失败，请重试。')
    } finally { setSaving(false) }
  }

  const state = snapshot?.state
  const pace = PACE[state?.protection?.mode] ?? null
  const length = lengthNote(state?.learning)
  return (
    <section aria-labelledby="her-state-title" className="rounded-card bg-surface-card p-4 shadow-card">
      <h3 id="her-state-title" className="text-sm font-semibold text-text-primary">她的状态</h3>
      <p className="mt-1 text-xs text-text-muted">她会按你们的对话调整说话的节奏和长短；这是模拟，不是她真的有情绪。</p>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      {!state && !error && <p role="status" className="mt-3 text-sm text-text-muted">正在读取…</p>}
      {state && <>
        <p className="mt-3 text-sm text-text-primary">{pace ?? '她现在是平常的节奏。'}</p>
        {length && <p className="mt-1 text-sm text-text-primary">{length}</p>}
        {pace && <>
          <button type="button" disabled={saving} onClick={recover} className="mt-4 min-h-11 rounded-control border border-border-default px-3 text-sm text-text-primary disabled:opacity-50">
            {saving ? '正在恢复…' : '恢复平稳节奏'}
          </button>
          <p className="mt-2 text-xs text-text-muted">恢复后保留已学习的表达习惯和记忆。</p>
        </>}
      </>}
    </section>
  )
}
