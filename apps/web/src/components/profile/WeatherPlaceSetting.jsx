import { useEffect, useState } from 'react'
import { CloudSun } from 'lucide-react'
import Card from '../ui/Card'
import { weatherService } from '../../services/weatherService'
import { useWeatherStore } from '../../stores/weatherStore'

export const placeLabel = (place) => [place.name, place.admin1, place.country].filter(Boolean).join(' · ')

const errorText = (error) => (error?.response?.status === 503
  ? '天气数据暂时连不上，稍后再试'
  : error?.response?.data?.error || '没找到，换个写法试试')

/**
 * 找城市：输入 → 找一找 → 从候选里选一个就存下。不定位。
 * 设置页的「天气」卡片与天气页（还没填城市、或想换一个时）共用。
 */
export function WeatherPlaceForm({ onSaved = undefined, placeholder = '你在哪个城市？比如：杭州' }) {
  const setPlace = useWeatherStore((state) => state.setPlace)
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState(/** @type {any[] | null} */ (null))
  const [busy, setBusy] = useState(false)
  const [tip, setTip] = useState('')
  const [error, setError] = useState('')

  const search = async (event) => {
    event.preventDefault()
    const q = query.trim()
    if (!q) return
    setBusy(true); setTip(''); setError(''); setPlaces(null)
    try {
      const found = await weatherService.searchPlaces(q)
      setPlaces(found)
      if (!found.length) setError('没找到这个地方，换个写法试试，比如「杭州」')
    } catch (requestError) {
      setError(errorText(requestError))
    } finally {
      setBusy(false)
    }
  }

  const choose = async (place) => {
    setBusy(true); setTip(''); setError('')
    try {
      await setPlace(place)
      setPlaces(null); setQuery('')
      setTip(`记下了：${place.name}`)
      onSaved?.(place)
    } catch (requestError) {
      setError(errorText(requestError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <form role="search" onSubmit={search} className="flex items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">城市名</span>
          <input
            value={query} onChange={(event) => setQuery(event.target.value)} maxLength={40} disabled={busy}
            placeholder={placeholder}
            className="min-h-11 w-full rounded-xl bg-surface-input px-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-status-info"
          />
        </label>
        <button type="submit" disabled={busy || !query.trim()} className="min-h-11 shrink-0 rounded-xl bg-action-primary px-4 text-sm font-semibold text-text-inverse disabled:opacity-50">
          {busy && places === null ? '找…' : '找一找'}
        </button>
      </form>
      {places && places.length > 0 && (
        <ul aria-label="选一个城市" className="divide-y divide-border-subtle overflow-hidden rounded-xl ring-1 ring-border-hairline">
          {places.map((place) => (
            <li key={`${place.latitude},${place.longitude}`}>
              <button type="button" disabled={busy} onClick={() => choose(place)} className="flex min-h-11 w-full items-center bg-surface-card px-3 text-left text-sm text-text-primary hover:bg-surface-muted disabled:opacity-50">
                {placeLabel(place)}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p aria-live="polite" className="min-h-5 text-xs text-text-secondary">
        {error ? <span role="alert" className="text-danger">{error}</span> : tip}
      </p>
    </div>
  )
}

// 设置里的「天气」：填一个城市就好，不定位。填了之后页头与天气页都有天气，她也会知道你那边冷不冷。
export default function WeatherPlaceSetting() {
  const weather = useWeatherStore((state) => state.weather)
  const status = useWeatherStore((state) => state.status)
  const load = useWeatherStore((state) => state.load)
  const clearPlace = useWeatherStore((state) => state.clearPlace)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => { load() }, [load])

  const clear = async () => {
    setBusy(true); setMessage('')
    try {
      await clearPlace()
      setMessage('清掉了，页头不再显示天气')
    } catch {
      setMessage('没清掉，稍后再试')
    } finally {
      setBusy(false)
    }
  }

  const current = weather?.place
  return (
    <Card className="overflow-hidden">
      <section aria-labelledby="weather-place-title" className="space-y-3 p-4">
        <h2 id="weather-place-title" className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <CloudSun size={16} className="text-action-primary" aria-hidden="true" />
          天气
        </h2>
        {current ? (
          <div className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-sm text-text-primary">现在的城市：{placeLabel(current)}</span>
            <button type="button" disabled={busy} onClick={clear} className="min-h-11 rounded-xl border border-border-subtle px-3 text-xs font-semibold text-text-secondary disabled:opacity-50">清除</button>
          </div>
        ) : status === 'error' ? (
          <p className="text-sm text-text-secondary">天气暂时取不到，城市还记着。</p>
        ) : null}
        <WeatherPlaceForm placeholder={current ? '换一个城市' : '你在哪个城市？比如：杭州'} onSaved={() => setMessage('')} />
        {message && <p aria-live="polite" className="text-xs text-text-secondary">{message}</p>}
        <p className="text-xs leading-relaxed text-text-muted">填一个城市就好，不用精确到街道，也不用定位。只用来查天气，也会让她知道你那边冷不冷；天气数据来自 Open-Meteo。</p>
      </section>
    </Card>
  )
}
