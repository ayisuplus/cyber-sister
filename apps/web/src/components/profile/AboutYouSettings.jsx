import { useEffect, useState } from 'react'
import { UserRound } from 'lucide-react'
import Card from '../ui/Card'
import { profileService } from '../../services/userService'
import { useAuthStore } from '../../stores/authStore'

// 关于你：她怎么叫你、你的生日。称呼每轮都会告诉她；生日平时不发给模型，只在前后一天让她知道。
export default function AboutYouSettings() {
  const [nickname, setNickname] = useState('')
  const [birthday, setBirthday] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tip, setTip] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    profileService.get()
      .then((profile) => {
        if (!alive) return
        setNickname(profile?.nickname ?? '')
        // 生日按日历日存（UTC 零点），取前十位就是那一天
        setBirthday(profile?.birthDate ? String(profile.birthDate).slice(0, 10) : '')
      })
      .catch(() => { if (alive) setError('没取到你的资料，刷新再试') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const save = async (event) => {
    event.preventDefault()
    setSaving(true); setTip(''); setError('')
    try {
      const name = nickname.trim()
      await profileService.update({ nickname: name, birthDate: birthday || null })
      useAuthStore.getState().updateProfile({ nickname: name })
      setTip('记下了')
    } catch {
      setError('没保存上，你填的还在')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="overflow-hidden">
      <form aria-labelledby="about-you-title" className="space-y-3 p-4" onSubmit={save}>
        <h2 id="about-you-title" className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <UserRound size={16} className="text-action-primary" aria-hidden="true" />
          关于你
        </h2>
        <label className="block">
          <span className="block text-sm text-text-primary">她怎么叫你</span>
          <input
            value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={50} disabled={loading}
            placeholder="比如：小鱼"
            className="mt-1 min-h-11 w-full rounded-xl bg-surface-input px-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-status-info"
          />
        </label>
        <label className="block">
          <span className="block text-sm text-text-primary">生日</span>
          <input
            type="date" value={birthday} onChange={(event) => setBirthday(event.target.value)} disabled={loading}
            className="mt-1 min-h-11 w-full rounded-xl bg-surface-input px-3 text-sm text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-status-info"
          />
        </label>
        <p className="text-xs leading-relaxed text-text-muted">称呼每次聊天都会告诉她；生日平时不发给模型，只在生日前后一天让她知道。</p>
        <div className="flex items-center gap-3">
          <p aria-live="polite" className="min-h-5 flex-1 text-xs text-text-secondary">
            {error ? <span role="alert" className="text-danger">{error}</span> : tip}
          </p>
          <button type="submit" disabled={loading || saving} className="min-h-11 rounded-xl bg-action-primary px-5 text-sm font-semibold text-text-inverse disabled:opacity-50">
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </Card>
  )
}
