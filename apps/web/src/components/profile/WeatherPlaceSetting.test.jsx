import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/weatherService', () => ({
  weatherService: { getWeather: vi.fn(), searchPlaces: vi.fn(), setPlace: vi.fn(), clearPlace: vi.fn() },
}))

import { weatherService } from '../../services/weatherService'
import { useWeatherStore } from '../../stores/weatherStore'
import WeatherPlaceSetting from './WeatherPlaceSetting'

const HANGZHOU = { name: '杭州', admin1: '浙江', country: '中国', latitude: 30.29, longitude: 120.16, timezone: 'Asia/Shanghai' }
const WEATHER = {
  place: { name: '杭州', admin1: '浙江', country: '中国' },
  current: null,
  today: { condition: '晴', icon: 'clear', min: 10, max: 20 },
  tomorrow: { condition: '阴', icon: 'cloudy', min: 9, max: 18 },
}

describe('WeatherPlaceSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWeatherStore.getState().reset()
  })

  it('说清楚：只填城市、不定位，数据来自 Open-Meteo', async () => {
    weatherService.getWeather.mockResolvedValue({ place: null })
    render(<WeatherPlaceSetting />)
    expect(screen.getByRole('heading', { name: '天气' })).toBeInTheDocument()
    expect(screen.getByText(/不用定位/)).toHaveTextContent('Open-Meteo')
    await vi.waitFor(() => expect(weatherService.getWeather).toHaveBeenCalled())
  })

  it('找一找 → 从候选里选一个 → 存下并重新拉天气', async () => {
    const user = userEvent.setup()
    weatherService.getWeather.mockResolvedValueOnce({ place: null }).mockResolvedValue(WEATHER)
    weatherService.searchPlaces.mockResolvedValue([HANGZHOU, { ...HANGZHOU, admin1: '四川', latitude: 30.06, longitude: 102.19 }])
    weatherService.setPlace.mockResolvedValue({ place: WEATHER.place })
    render(<WeatherPlaceSetting />)

    await user.type(screen.getByRole('textbox', { name: '城市名' }), '杭州')
    await user.click(screen.getByRole('button', { name: '找一找' }))
    expect(weatherService.searchPlaces).toHaveBeenCalledWith('杭州')
    const list = await screen.findByRole('list', { name: '选一个城市' })
    await user.click(screen.getByRole('button', { name: '杭州 · 浙江 · 中国' }))

    expect(weatherService.setPlace).toHaveBeenCalledWith(HANGZHOU)
    expect(await screen.findByText('记下了：杭州')).toBeInTheDocument()
    expect(list).not.toBeInTheDocument()
    expect(screen.getByText('现在的城市：杭州 · 浙江 · 中国')).toBeInTheDocument()
  })

  it('没找到、数据源连不上时说实话', async () => {
    const user = userEvent.setup()
    weatherService.getWeather.mockResolvedValue({ place: null })
    weatherService.searchPlaces.mockResolvedValueOnce([])
    render(<WeatherPlaceSetting />)
    await user.type(screen.getByRole('textbox', { name: '城市名' }), '不存在')
    await user.click(screen.getByRole('button', { name: '找一找' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('没找到这个地方')

    weatherService.searchPlaces.mockRejectedValueOnce({ response: { status: 503 } })
    await user.click(screen.getByRole('button', { name: '找一找' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('天气数据暂时连不上')
  })

  it('清除城市', async () => {
    const user = userEvent.setup()
    weatherService.getWeather.mockResolvedValue(WEATHER)
    weatherService.clearPlace.mockResolvedValue({ place: null })
    render(<WeatherPlaceSetting />)
    await user.click(await screen.findByRole('button', { name: '清除' }))
    expect(weatherService.clearPlace).toHaveBeenCalled()
    expect(await screen.findByText('清掉了，页头不再显示天气')).toBeInTheDocument()
    expect(screen.queryByText(/现在的城市/)).not.toBeInTheDocument()
  })
})
