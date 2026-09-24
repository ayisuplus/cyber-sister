import { useEffect, useState } from 'react'
import { profileService } from '../../services/userService'

const OPTIONS = [
  { value: 'on', label: '提一句', preview: '《…》里讲过' },
  { value: 'off', label: '不提', preview: '——' },
]

// 回答里提到书（路线图 C22）：她翻到书时，要不要在回答里自然地提一句书名和章节。
// 默认不提，照样按书的思路回你；跟着账户走，换设备也一样。
export default function CiteBooksSetting() {
  const [value, setValue] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    profileService.get()
      .then((profile) => { if (alive) setValue(profile?.citeBooks ? 'on' : 'off') })
      .catch(() => { if (alive) setError('暂时读不到这项设置') })
    return () => { alive = false }
  }, [])

  const choose = async (next) => {
    if (value === null || saving || next === value) return
    const previous = value
    setValue(next)
    setSaving(true)
    setError('')
    try {
      const profile = await profileService.update({ citeBooks: next === 'on' })
      setValue(profile?.citeBooks ? 'on' : 'off')
    } catch {
      setValue(previous)
      setError('没保存上，请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <fieldset className="mt-4" disabled={value === null || saving}>
      <legend className="text-xs text-text-secondary">回答里提到书</legend>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {OPTIONS.map((option) => (
          <label key={option.value} className={`flex cursor-pointer flex-col items-center gap-1 rounded-control border px-2 py-3 text-xs ${value === option.value ? 'border-action-primary bg-pastel-blush text-text-primary' : 'border-border-default bg-surface-card text-text-secondary'}`}>
            <span aria-hidden="true" className="flex h-7 items-center text-text-muted">{option.preview}</span>
            <span>{option.label}</span>
            <input type="radio" name="cite-books" value={option.value} checked={value === option.value} onChange={() => choose(option.value)} aria-label={`回答里提到书：${option.label}`} className="h-4 w-4 accent-action-primary" />
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-text-muted">她翻到书时，可以在回答里自然地提一句书名；不喜欢就选不提，她照样按书的思路回你。跟着账户走，换设备也一样。</p>
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </fieldset>
  )
}
