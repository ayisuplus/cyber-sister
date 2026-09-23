import { useEffect, useState } from 'react'
import Header from '../components/layout/Header'
import CompanionStatePanel from '../components/chat/CompanionStatePanel'
import LetterView from '../components/letter/LetterView'
import MemoriesPage from './MemoriesPage'
import { useAuthStore } from '../stores/authStore'
import { SPEAKING_STYLES, getPersona } from '../features/personas'
import { profileService } from '../services/userService'
import { letterService } from '../services/letterService'

// 写信频率：默认不写（跟「做梦默认关」同口径），改频率立即影响下一封
const FREQ_OPTIONS = [
  { value: null, label: '不写了' },
  { value: 3, label: '三天一封' },
  { value: 7, label: '七天一封' },
]

// periodStart 是周期起点（本地日，UTC 零点存）：用 UTC 的月日读，才是那一天
const periodLabel = (value) => {
  const day = new Date(value)
  return Number.isNaN(day.getTime()) ? '' : `${day.getUTCMonth() + 1}月${day.getUTCDate()}日`
}

/** 写信频率：三档单选，保存中禁用，行内说清结果。 */
function LetterFreqSetting() {
  const [freq, setFreq] = useState(undefined) // undefined=还没读到
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let alive = true
    profileService.get()
      .then((profile) => { if (alive) setFreq(profile?.letterFreqDays ?? null) })
      .catch(() => { if (alive) setMessage('暂时读不到写信设置，请稍后再试。') })
    return () => { alive = false }
  }, [])

  const choose = async (value) => {
    if (saving || freq === undefined || value === freq) return
    setSaving(true)
    setMessage('')
    const previous = freq
    setFreq(value)
    try {
      const profile = await profileService.update({ letterFreqDays: value })
      setFreq(profile?.letterFreqDays ?? value)
      setMessage(value === null ? '好，她先不写了。' : '记下了，到了日子她会写。')
    } catch {
      setFreq(previous)
      setMessage('没保存成功，请重试。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 rounded-card bg-surface-card p-4 shadow-card">
      <p className="text-sm text-text-primary">多久写一封</p>
      <p className="mt-1 text-[11px] leading-relaxed text-text-muted">她按你定的频率写，凭她记得的你和你们的近况写。信里有她的看法和打趣，也可能有几条建议——改不改、做不做，你说了算。</p>
      <fieldset className="mt-3" disabled={saving || freq === undefined}>
        <legend className="sr-only">写信频率</legend>
        <div className="grid grid-cols-3 gap-2">
          {FREQ_OPTIONS.map((option) => (
            <label key={option.label}
              className={`flex min-h-11 cursor-pointer items-center justify-center rounded-control border px-2 text-sm transition-colors duration-300 ease-calm ${freq === option.value ? 'border-action-primary bg-pastel-blush text-text-primary' : 'border-border-subtle bg-surface-card text-text-secondary hover:bg-surface-muted'}`}>
              <input type="radio" name="letter-freq" className="sr-only" checked={freq === option.value}
                onChange={() => choose(option.value)} />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      <p aria-live="polite" className="mt-2 min-h-5 text-xs text-text-secondary">{message}</p>
    </div>
  )
}

// 「她」：她怎么和你说话、她此刻的节奏、她的来信、她记得的你——关于她的一切都在这一处。
export default function HerPage() {
  const user = useAuthStore(state => state.user)
  const updatePersona = useAuthStore(state => state.updatePersona)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const current = user?.persona
  const retired = Boolean(current) && !SPEAKING_STYLES.some(style => style.id === current)

  const [letters, setLetters] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [reason, setReason] = useState(null)
  const [lettersError, setLettersError] = useState('')

  // 进页面先让信到期就写（幂等），再读全部来信；生成失败也不挡看旧信
  useEffect(() => {
    let alive = true
    ;(async () => {
      let generateReason = null
      try {
        generateReason = (await letterService.generate())?.reason ?? null
      } catch { /* 写不成这次就不写 */ }
      try {
        const list = await letterService.list()
        if (!alive) return
        setLetters(Array.isArray(list) ? list : [])
        setSelectedId((currentId) => currentId ?? list?.[0]?.id ?? null)
        setReason(generateReason)
      } catch {
        if (alive) setLettersError('来信暂时读不到，请重试。')
      }
    })()
    return () => { alive = false }
  }, [])

  const choose = async (id) => {
    if (saving || id === current) return
    setSaving(true)
    setMessage('')
    try {
      await updatePersona(id)
      setMessage('换好了，下一条消息就用这种方式和你说话')
    } catch {
      setMessage('没换成功，请重试')
    } finally {
      setSaving(false)
    }
  }

  const handleDecided = (updated) => {
    setLetters((items) => items.map((item) => (item.id === updated.id ? updated : item)))
  }

  const shown = letters.find((letter) => letter.id === selectedId) ?? letters[0] ?? null
  const past = letters.filter((letter) => letter.id !== shown?.id)
  const emptyText = reason === 'quiet'
    ? '这几天没什么可写的，她想攒点话再给你写。'
    : '她还没写好第一封，到了日子她会写的。'

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header title="她" showBack />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
          <section aria-labelledby="her-style-title" className="rounded-card bg-surface-card p-4 shadow-card">
            <h2 id="her-style-title" className="text-sm font-semibold text-text-primary">她的说话方式</h2>
            {retired && <p className="mt-1 text-xs text-text-muted">你之前选的「{getPersona(current).name}」已经合并了，选一种新的吧。</p>}
            <div className="mt-3 grid grid-cols-3 gap-2">
              {SPEAKING_STYLES.map(style => {
                const active = style.id === current
                return (
                  <button
                    key={style.id}
                    type="button"
                    aria-pressed={active}
                    disabled={saving}
                    onClick={() => choose(style.id)}
                    className={`min-h-[88px] rounded-control border p-3 text-left transition-colors duration-300 ease-calm disabled:opacity-50 ${active ? 'border-action-primary bg-pastel-blush' : 'border-border-subtle bg-surface-card hover:bg-surface-muted'}`}
                  >
                    <span className="block font-display text-base text-text-primary">{style.label}</span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-text-secondary">{style.description}</span>
                  </button>
                )
              })}
            </div>
            <p aria-live="polite" className="mt-2 min-h-5 text-xs text-text-secondary">{message}</p>
          </section>

          <CompanionStatePanel />

          <section aria-labelledby="her-letters-title">
            <h2 id="her-letters-title" className="px-1 text-sm font-semibold text-text-primary">她的来信</h2>
            <LetterFreqSetting />
            <div className="mt-3 rounded-card bg-surface-card p-4 shadow-card">
              {lettersError
                ? <p role="alert" className="text-sm text-danger">{lettersError}</p>
                : shown
                  ? <LetterView key={shown.id} letter={shown} onDecided={handleDecided} />
                  : <p className="text-sm text-text-secondary">{emptyText}</p>}
            </div>
            {past.length > 0 && (
              <nav aria-label="往期来信" className="mt-3 rounded-card bg-surface-card p-4 shadow-card">
                <h3 className="text-xs font-semibold text-text-primary">往期</h3>
                <ul className="mt-2 divide-y divide-border-subtle">
                  {past.map((letter) => (
                    <li key={letter.id}>
                      <button type="button" onClick={() => setSelectedId(letter.id)}
                        className="min-h-11 w-full py-2 text-left text-sm text-text-secondary">
                        {periodLabel(letter.periodStart)}的信
                      </button>
                    </li>
                  ))}
                </ul>
                {shown && letters.length > 1 && shown.id !== letters[0].id && (
                  <button type="button" onClick={() => setSelectedId(letters[0].id)}
                    className="min-h-11 text-xs text-action-primary">回到最新一封</button>
                )}
              </nav>
            )}
          </section>

          <section aria-labelledby="her-memory-title">
            <h2 id="her-memory-title" className="px-1 text-sm font-semibold text-text-primary">她记得的你</h2>
            <MemoriesPage embedded />
          </section>
        </div>
      </div>
    </div>
  )
}
