import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  default: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

import api from './api'
import { weatherService } from './weatherService'

describe('weatherService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('天气走独立的 /weather，不经过工具箱', async () => {
    api.get.mockResolvedValue({ data: { place: null } })
    await expect(weatherService.getWeather()).resolves.toEqual({ place: null })
    expect(api.get).toHaveBeenCalledWith('/weather')
  })

  it('找城市：把查询词作为参数；拿不到数组就当没有候选', async () => {
    api.get.mockResolvedValueOnce({ data: { places: [{ name: '杭州' }] } })
    await expect(weatherService.searchPlaces('杭州')).resolves.toEqual([{ name: '杭州' }])
    expect(api.get).toHaveBeenCalledWith('/weather/places', { params: { q: '杭州' } })
    api.get.mockResolvedValueOnce({ data: {} })
    await expect(weatherService.searchPlaces('x')).resolves.toEqual([])
  })

  it('保存与清除城市', async () => {
    api.put.mockResolvedValue({ data: { place: { name: '杭州' } } })
    api.delete.mockResolvedValue({ data: { place: null } })
    const place = { name: '杭州', latitude: 30.29, longitude: 120.16 }
    await weatherService.setPlace(place)
    expect(api.put).toHaveBeenCalledWith('/weather/place', place)
    await weatherService.clearPlace()
    expect(api.delete).toHaveBeenCalledWith('/weather/place')
  })
})
