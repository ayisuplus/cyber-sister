import { useEffect, useState } from 'react'
import '@chinese-fonts/mkwtyt/dist/MaoKenTangYuan/result.css'
import Header from '../components/layout/Header'
import WeatherScene from '../components/weather/WeatherScene'
import { WeatherPlaceForm } from '../components/profile/WeatherPlaceSetting'
import { Squiggle } from '../components/chat/Doodles'
import { useWeatherStore } from '../stores/weatherStore'
import { useAuthStore } from '../stores/authStore'
import { showsTomorrow } from '../features/weather'
import { pickNote } from '../features/weatherNotes'

// 天气页（路线图 C29）：一大幅可爱的简笔画、一行天气和温度、下面用圆圆的字写一句温馨提醒。
// 不堆参数：不写湿度、风速、气压、降水概率。白天看今天，傍晚以后看明天，也可以自己切。
// 没填城市就在这一页填；取不到时如实说取不到，不给假天气。

const todayKey = () => {
  const now = new Date()
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
}

function EmptyCity() {
  return (
    <div className="flex flex-col items-center text-center">
      <WeatherScene icon="partly" className="weather-scene--small" />
      <p className="mt-4 font-round text-[20px] leading-relaxed text-text-primary">告诉我你在哪个城市吧</p>
      <p className="mb-4 mt-1 text-xs text-text-muted">填城市名就好，不用定位</p>
      <div className="w-full max-w-sm text-left"><WeatherPlaceForm /></div>
    </div>
  )
}

export default function WeatherPage() {
  const weather = useWeatherStore((state) => state.weather)
  const status = useWeatherStore((state) => state.status)
  const load = useWeatherStore((state) => state.load)
  const persona = useAuthStore((state) => state.user?.persona)
  const [autoTomorrow] = useState(() => showsTomorrow(new Date().getHours()))
  const [tomorrow, setTomorrow] = useState(autoTomorrow)
  const [turn, setTurn] = useState(0)
  const [changingCity, setChangingCity] = useState(false)

  useEffect(() => { load() }, [load])

  const ready = status === 'ready' && weather?.today && weather?.tomorrow
  const day = ready ? (tomorrow ? weather.tomorrow : weather.today) : null
  const note = ready ? pickNote(weather, { tomorrow, persona, turn, dateKey: todayKey() }) : ''

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-transparent">
      <Header title="天气" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-md flex-col items-center px-5 pb-10 pt-6">
          {status === 'idle' && <div className="h-64" aria-busy="true" />}

          {status === 'none' && <EmptyCity />}

          {status === 'error' && (
            <div className="flex flex-col items-center text-center">
              <WeatherScene icon="cloudy" className="weather-scene--small" />
              <p className="mt-4 font-round text-[20px] text-text-primary">天气暂时连不上</p>
              <p className="mt-1 text-xs text-text-muted">晚一点再来看看，不给你看不准的天气</p>
              <button type="button" onClick={() => load({ force: true })} className="mt-4 min-h-11 rounded-full border border-border-subtle bg-surface-card px-5 text-sm text-text-secondary">再试一次</button>
            </div>
          )}

          {ready && (
            <>
              <p className="font-round text-[15px] tracking-[0.12em] text-text-secondary">
                {weather.place.name} · {tomorrow ? '明天' : '今天'}
              </p>
              <WeatherScene key={`${day.icon}-${tomorrow}`} icon={day.icon} className="mt-3" />
              <h2 className="mt-2 font-round text-[34px] leading-tight text-text-primary">{day.condition}</h2>
              <p className="mt-1 font-round text-[20px] tabular-nums text-text-secondary">{day.min}° ~ {day.max}°</p>

              <div className="mt-6 flex justify-center"><Squiggle /></div>
              <button
                type="button"
                onClick={() => setTurn((value) => value + 1)}
                aria-label={`${note}（点一下换一句）`}
                className="weather-note mt-3 max-w-[18rem] rounded-card px-3 py-2 text-center font-round text-[22px] leading-[1.7] text-text-primary"
              >
                {note}
              </button>

              <div className="mt-8 flex items-center gap-3 text-xs text-text-muted">
                <button type="button" onClick={() => { setTomorrow((value) => !value); setTurn(0) }} className="min-h-11 rounded-full px-3 hover:text-text-secondary">
                  {tomorrow ? '看看今天' : '看看明天'}
                </button>
                <span aria-hidden="true">·</span>
                <button type="button" onClick={() => setChangingCity((value) => !value)} aria-expanded={changingCity} className="min-h-11 rounded-full px-3 hover:text-text-secondary">
                  换个城市
                </button>
              </div>
              {changingCity && (
                <div className="mt-2 w-full max-w-sm">
                  <WeatherPlaceForm placeholder="换一个城市" onSaved={() => setChangingCity(false)} />
                </div>
              )}
              <p className="mt-4 text-[10px] text-text-muted">数据来自 Open-Meteo</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
