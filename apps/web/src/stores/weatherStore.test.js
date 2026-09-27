import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/weatherService', () => ({
  weatherService: { getWeather: vi.fn(), setPlace: vi.fn(), clearPlace: vi.fn() },
}))

import { weatherService } from '../services/weatherService'
import { resetSession } from '../services/sessionLifecycle'
import { useWeatherStore } from './weatherStore'

const READY = {
  place: { name: '杭州' },
  current: null,
  today: { condition: '晴', icon: 'clear', min: 10, max: 20 },
  tomorrow: { condition: '阴', icon: 'cloudy', min: 9, max: 18 },
  source: 'Open-Meteo',
}

describe('weatherStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWeatherStore.getState().reset()
  })

  it('没填城市：状态 none，没有天气', async () => {
    weatherService.getWeather.mockResolvedValue({ place: null })
    await useWeatherStore.getState().load()
    expect(useWeatherStore.getState()).toMatchObject({ status: 'none', weather: null })
  })

  it('有天气时存下；半小时内不重复拉，除非强制', async () => {
    weatherService.getWeather.mockResolvedValue(READY)
    await useWeatherStore.getState().load()
    await useWeatherStore.getState().load()
    expect(weatherService.getWeather).toHaveBeenCalledTimes(1)
    expect(useWeatherStore.getState()).toMatchObject({ status: 'ready', weather: READY })
    await useWeatherStore.getState().load({ force: true })
    expect(weatherService.getWeather).toHaveBeenCalledTimes(2)
  })

  it('取不到时连旧数据一起收起来，不显示可能过期的天气', async () => {
    weatherService.getWeather.mockResolvedValueOnce(READY)
    await useWeatherStore.getState().load()
    weatherService.getWeather.mockRejectedValueOnce(Object.assign(new Error('503'), { response: { status: 503 } }))
    await useWeatherStore.getState().load({ force: true })
    expect(useWeatherStore.getState()).toMatchObject({ status: 'error', weather: null })
  })

  it('选了城市就重新拉；清除后立刻不显示', async () => {
    weatherService.setPlace.mockResolvedValue({ place: { name: '杭州' } })
    weatherService.getWeather.mockResolvedValue(READY)
    await useWeatherStore.getState().setPlace({ name: '杭州', latitude: 30, longitude: 120 })
    expect(useWeatherStore.getState().weather).toEqual(READY)
    weatherService.clearPlace.mockResolvedValue({ place: null })
    await useWeatherStore.getState().clearPlace()
    expect(useWeatherStore.getState()).toMatchObject({ status: 'none', weather: null })
  })

  it('退出登录后清空；退出前发出的请求回来也不写回', async () => {
    let resolve
    weatherService.getWeather.mockReturnValue(new Promise((done) => { resolve = done }))
    const pending = useWeatherStore.getState().load()
    resetSession()
    resolve(READY)
    await pending
    expect(useWeatherStore.getState()).toMatchObject({ status: 'idle', weather: null })
  })
})
