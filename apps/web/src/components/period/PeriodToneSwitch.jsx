import { useEffect, useState } from 'react'
import { ToggleLeft, ToggleRight } from 'lucide-react'
import { toolsService } from '../../services/toolsService'

// 「聊天时让她顾及你的周期」：记录同意之外单独的一项，默认关闭。
// 打开后只把「这几天在经期」交给模型调语气；她不会主动提起，也不会记下来。撤回记录同意时服务端一并关掉。
export default function PeriodToneSwitch() {
  const [enabled, setEnabled] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    toolsService.getPeriodTone()
      .then((tone) => { if (alive) setEnabled(tone?.enabled === true) })
      .catch(() => { if (alive) setError('暂时读不到这个开关，请稍后再试。') })
    return () => { alive = false }
  }, [])

  const toggle = async () => {
    if (enabled === null || saving) return
    setSaving(true)
    setError('')
    try {
      const tone = await toolsService.setPeriodTone(!enabled)
      setEnabled(tone?.enabled === true)
    } catch {
      setError('没保存成功，请重试。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-card bg-surface-card p-4 shadow-card">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text-primary">聊天时让她顾及你的周期</p>
        <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
          打开后，你在经期里的那几天，每次聊天会告诉云端模型「你这几天在经期」，只用来让她说话更软、更有耐心。她不会主动提起，也不会记下来。你随时可以关掉。
        </p>
        {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
      </div>
      <button type="button" role="switch" aria-checked={enabled === true} aria-label="聊天时让她顾及你的周期" disabled={enabled === null || saving} onClick={toggle} className="flex h-11 w-11 shrink-0 items-center justify-center disabled:opacity-40">
        {enabled ? <ToggleRight size={24} className="text-action-primary" aria-hidden="true" /> : <ToggleLeft size={24} className="text-text-muted" aria-hidden="true" />}
      </button>
    </div>
  )
}
