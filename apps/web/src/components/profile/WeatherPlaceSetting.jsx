import { useEffect, useState } from 'react'
import { CloudSun } from 'lucide-react'
import Card from '../ui/Card'
import { weatherService } from '../../services/weatherService'
import { useWeatherStore } from '../../stores/weatherStore'

const placeLabel = (place) => [place.name, place.admin1, place.country].filter(Boolean).join(' · ')

const errorText = (error) => (error?.response?.status === 503
  ? '天气数据暂时连不上，稍后再试'
  : error?.response?.data?.error || '没找到，换个写法试试')

// 天气：填一个城市就好，不定位。填了之后页头会有一行天气，她也会知道你那边冷不冷。
export default function WeatherPlaceSetting() {
  const weather = useWeatherStore((state) => state.weather)
  const status = useWeatherStore((state) => state.status)
  const load = useWeatherStore((state) => state.load)
  const setPlace = useWeatherStore((state) => state.setPlace)
  const clearPlace = useWeatherStore((state) => state.clearPlace)
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState(/** @type {any[] | null} */ (null))
  const [busy, setBusy] = useState(false)
  const [tip, setTip] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { load() }, [load])

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
    } catch (requestError) {
      setError(errorText(requestError))
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setBusy(true); setTip(''); setError('')
    try {
      await clearPlace()
      setTip('清掉了，页头不再显示天气')
    } catch {
      setError('没清掉，稍后再试')
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
        <form role="search" onSubmit={search} className="flex items-center gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">城市名</span>
            <input
              value={query} onChange={(event) => setQuery(event.target.value)} maxLength={40} disabled={busy}
              placeholder={current ? '换一个城市' : '你在哪个城市？比如：杭州'}
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
                <button type="button" disabled={busy} onClick={() => choose(place)} className="flex min-h-11 w-full items-center px-3 text-left text-sm text-text-primary hover:bg-surface-muted disabled:opacity-50">
                  {placeLabel(place)}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs leading-relaxed text-text-muted">填一个城市就好，不用精确到街道，也不用定位。只用来查天气，也会让她知道你那边冷不冷；天气数据来自 Open-Meteo。</p>
        <p aria-live="polite" className="min-h-5 text-xs text-text-secondary">
          {error ? <span role="alert" className="text-danger">{error}</span> : tip}
        </p>
      </section>
    </Card>
  )
}
