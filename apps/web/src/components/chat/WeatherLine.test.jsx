import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/weatherService', () => ({
  weatherService: { getWeather: vi.fn(), setPlace: vi.fn(), clearPlace: vi.fn() },
}))

import { weatherService } from '../../services/weatherService'
import { useWeatherStore } from '../../stores/weatherStore'
import WeatherLine from './WeatherLine'

const WEATHER = {
  place: { name: '杭州', admin1: '浙江', country: '中国' },
  current: { temperature: 18, condition: '小雨', icon: 'rain' },
  today: { date: '2026-09-27', condition: '小雨', icon: 'rain', min: 14, max: 19, precipitation: 80 },
  tomorrow: { date: '2026-09-28', condition: '晴', icon: 'clear', min: 6, max: 12, precipitation: 0 },
  source: 'Open-Meteo',
}

const at = (hour) => vi.setSystemTime(new Date(2026, 8, 27, hour, 10))
const renderLine = () => render(<MemoryRouter><WeatherLine /></MemoryRouter>)

describe('WeatherLine', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] })
    vi.clearAllMocks()
    useWeatherStore.getState().reset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('没填城市或取不到时什么都不渲染', async () => {
    weatherService.getWeather.mockResolvedValue({ place: null })
    const { container, unmount } = renderLine()
    await vi.waitFor(() => expect(useWeatherStore.getState().status).toBe('none'))
    expect(container).toBeEmptyDOMElement()
    unmount()

    useWeatherStore.getState().reset()
    weatherService.getWeather.mockRejectedValue(new Error('503'))
    const failed = renderLine()
    await vi.waitFor(() => expect(useWeatherStore.getState().status).toBe('error'))
    expect(failed.container).toBeEmptyDOMElement()
  })

  it('白天写城市与此刻', async () => {
    at(10)
    weatherService.getWeather.mockResolvedValue(WEATHER)
    renderLine()
    expect(await screen.findByRole('button', { name: /杭州 · 小雨 18°/ })).toBeInTheDocument()
  })

  it('傍晚以后写明天', async () => {
    at(23)
    weatherService.getWeather.mockResolvedValue(WEATHER)
    renderLine()
    expect(await screen.findByRole('button', { name: /明天 · 晴 6–12°/ })).toBeInTheDocument()
  })

  it('点开是今天与明天的小卡片，带一句惦记与数据署名；Esc 收起、焦点回到那一行', async () => {
    at(23)
    const user = userEvent.setup()
    weatherService.getWeather.mockResolvedValue(WEATHER)
    renderLine()
    const trigger = await screen.findByRole('button', { name: /明天/ })
    await user.click(trigger)

    const card = screen.getByRole('dialog', { name: '杭州 · 浙江' })
    expect(card).toHaveTextContent('今天')
    expect(card).toHaveTextContent('小雨')
    expect(card).toHaveTextContent('降水 80%')
    expect(card).toHaveTextContent('明天降温了，多穿一件')
    expect(card).toHaveTextContent('数据来自 Open-Meteo')
    expect(screen.getByRole('link', { name: '去天气页看看' })).toHaveAttribute('href', '/tools/weather')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('点卡片外面也会收起', async () => {
    at(10)
    const user = userEvent.setup()
    weatherService.getWeather.mockResolvedValue(WEATHER)
    render(<MemoryRouter><p>外面</p><WeatherLine /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: /杭州/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByText('外面'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
