import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/weatherService', () => ({
  weatherService: { getWeather: vi.fn(), searchPlaces: vi.fn(), setPlace: vi.fn(), clearPlace: vi.fn() },
}))

import { weatherService } from '../services/weatherService'
import { useWeatherStore } from '../stores/weatherStore'
import { useAuthStore } from '../stores/authStore'
import { NOTES, SPECIAL_NOTES } from '../features/weatherNotes'
import WeatherPage from './WeatherPage'

const WEATHER = {
  place: { name: '杭州', admin1: '浙江', country: '中国' },
  current: { temperature: 18, condition: '小雨', icon: 'rain' },
  today: { date: '2026-09-27', condition: '小雨', icon: 'rain', min: 14, max: 19, precipitation: 80 },
  tomorrow: { date: '2026-09-28', condition: '晴', icon: 'clear', min: 13, max: 21, precipitation: 0 },
  source: 'Open-Meteo',
}

const renderPage = () => render(<MemoryRouter><WeatherPage /></MemoryRouter>)

describe('WeatherPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] })
    vi.clearAllMocks()
    useWeatherStore.getState().reset()
    useAuthStore.setState({ user: { id: 'u', nickname: '小鱼', persona: 'gentle' } })
  })

  afterEach(() => vi.useRealTimers())

  it('白天：城市 · 今天、一大幅简笔画、天气和温度、一句温馨提醒；不堆参数', async () => {
    vi.setSystemTime(new Date(2026, 8, 27, 10, 0))
    weatherService.getWeather.mockResolvedValue(WEATHER)
    const { container } = renderPage()
    expect(await screen.findByText('杭州 · 今天')).toBeInTheDocument()
    expect(container.querySelector('.weather-scene')).toHaveAttribute('data-kind', 'rain')
    expect(container.querySelector('.weather-scene img')).toHaveAttribute('src', '/design-assets/weather/rain.webp')
    expect(screen.getByRole('heading', { name: '小雨' })).toBeInTheDocument()
    expect(screen.getByText('14° ~ 19°')).toBeInTheDocument()
    const note = screen.getByRole('button', { name: /点一下换一句/ })
    expect(NOTES.rain.today.gentle).toContain(note.textContent)
    // 不堆参数：湿度、风速、降水概率一概不写
    expect(document.body.textContent).not.toMatch(/湿度|风速|气压|降水|%/)
    expect(screen.getByText('数据来自 Open-Meteo')).toBeInTheDocument()
  })

  it('傍晚以后看明天；也可以自己切回今天', async () => {
    vi.setSystemTime(new Date(2026, 8, 27, 23, 0))
    const user = userEvent.setup()
    weatherService.getWeather.mockResolvedValue(WEATHER)
    renderPage()
    expect(await screen.findByText('杭州 · 明天')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '晴' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '看看今天' }))
    expect(screen.getByText('杭州 · 今天')).toBeInTheDocument()
  })

  it('点一下温馨提醒，换一句', async () => {
    vi.setSystemTime(new Date(2026, 8, 27, 10, 0))
    const user = userEvent.setup()
    weatherService.getWeather.mockResolvedValue(WEATHER)
    renderPage()
    const note = await screen.findByRole('button', { name: /点一下换一句/ })
    const first = note.textContent
    await user.click(note)
    expect(screen.getByRole('button', { name: /点一下换一句/ }).textContent).not.toBe(first)
  })

  it('按她的说话方式说；明天降温先说降温', async () => {
    vi.setSystemTime(new Date(2026, 8, 27, 23, 0))
    useAuthStore.setState({ user: { id: 'u', persona: 'cool' } })
    weatherService.getWeather.mockResolvedValue({ ...WEATHER, tomorrow: { ...WEATHER.tomorrow, max: 10 } })
    renderPage()
    const note = await screen.findByRole('button', { name: /点一下换一句/ })
    expect(SPECIAL_NOTES.drop.cool).toContain(note.textContent)
  })

  it('没填城市：就在这一页填', async () => {
    weatherService.getWeather.mockResolvedValue({ place: null })
    renderPage()
    expect(await screen.findByText('告诉我你在哪个城市吧')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '城市名' })).toBeInTheDocument()
  })

  it('取不到：如实说连不上，不给假天气；可以再试', async () => {
    const user = userEvent.setup()
    weatherService.getWeather.mockRejectedValueOnce(new Error('503')).mockResolvedValue(WEATHER)
    renderPage()
    expect(await screen.findByText('天气暂时连不上')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '再试一次' }))
    expect(await screen.findByText(/杭州 ·/)).toBeInTheDocument()
  })
})
