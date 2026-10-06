import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
}))
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))

vi.mock('../prisma/client.js', () => ({
  default: { user: { findUnique: db.userFindUnique, update: db.userUpdate } },
}))
vi.mock('../utils/logger.js', () => ({ default: log }))

import {
  clearPlace,
  clearWeatherCache,
  describeWeatherCode,
  getForecast,
  getUserWeather,
  isWeatherEnabled,
  normalizePlace,
  parseForecast,
  searchPlaces,
  setPlace,
  weatherForContext,
} from './weatherService.js'

const HANGZHOU = { name: '杭州', admin1: '浙江', country: '中国', latitude: 30.29365, longitude: 120.16142, timezone: 'Asia/Shanghai' }

const FORECAST = {
  current: { temperature_2m: 24.3, weather_code: 1 },
  daily: {
    time: ['2026-09-27', '2026-09-28'],
    weather_code: [61, 3],
    temperature_2m_max: [22.6, 15.4],
    temperature_2m_min: [16.2, 9.5],
    precipitation_probability_max: [80, 10],
  },
}

const ok = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })

beforeEach(() => {
  vi.clearAllMocks()
  clearWeatherCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('天气代码', () => {
  it('常见 WMO 代码译成中文天气与图标键', () => {
    expect(describeWeatherCode(0)).toEqual({ condition: '晴', icon: 'clear' })
    expect(describeWeatherCode(3)).toEqual({ condition: '阴', icon: 'cloudy' })
    expect(describeWeatherCode(61)).toEqual({ condition: '小雨', icon: 'rain' })
    expect(describeWeatherCode(75)).toEqual({ condition: '大雪', icon: 'snow' })
    expect(describeWeatherCode(95)).toEqual({ condition: '雷阵雨', icon: 'thunder' })
    // 冰雹只在中欧可靠，别处不渲染成「伴冰雹」
    expect(describeWeatherCode(96)).toEqual({ condition: '雷阵雨', icon: 'thunder' })
  })

  it('不认识的代码不猜', () => {
    expect(describeWeatherCode(42)).toBeNull()
    expect(describeWeatherCode(undefined)).toBeNull()
  })
})

describe('开关', () => {
  it('默认开启，只有明确写 false 才关', () => {
    expect(isWeatherEnabled({})).toBe(true)
    expect(isWeatherEnabled({ WEATHER_ENABLED: 'true' })).toBe(true)
    expect(isWeatherEnabled({ WEATHER_ENABLED: 'false' })).toBe(false)
  })
})

describe('城市校验', () => {
  it('只保留名字、省份、国家、坐标与时区', () => {
    expect(normalizePlace({ ...HANGZHOU, id: 1808926, population: 9236032 })).toEqual(HANGZHOU)
  })

  it('缺名字或坐标越界时拒绝', () => {
    expect(() => normalizePlace({ ...HANGZHOU, name: '  ' })).toThrow('请从候选里选一个城市')
    expect(() => normalizePlace({ ...HANGZHOU, latitude: 91 })).toThrow()
    expect(() => normalizePlace({ ...HANGZHOU, longitude: '120' })).toThrow()
  })

  it('长名字截断，非法时区丢掉', () => {
    const place = normalizePlace({ ...HANGZHOU, name: '长'.repeat(60), timezone: 'Asia/Shanghai; drop' })
    expect(place.name).toHaveLength(40)
    expect(place.timezone).toBeNull()
  })
})

describe('找城市', () => {
  it('中文查询、最多 5 个候选，缺坐标的丢掉', async () => {
    const fetch = vi.fn(() => ok({ results: [HANGZHOU, { name: '坏的' }, { ...HANGZHOU, admin1: '四川', latitude: 30.06 }] }))
    vi.stubGlobal('fetch', fetch)
    const { places } = await searchPlaces(' 杭州 ')
    expect(places).toHaveLength(2)
    expect(places[0]).toEqual(HANGZHOU)
    const url = new URL(fetch.mock.calls[0][0])
    expect(url.hostname).toBe('geocoding-api.open-meteo.com')
    expect(url.searchParams.get('name')).toBe('杭州')
    expect(url.searchParams.get('language')).toBe('zh')
  })

  it('没有结果时是空数组', async () => {
    vi.stubGlobal('fetch', vi.fn(() => ok({ generationtime_ms: 0.1 })))
    await expect(searchPlaces('不存在的地方')).resolves.toEqual({ places: [] })
  })

  it('空查询 400，关闭时 503，数据源失败 503 且日志不含查询词', async () => {
    await expect(searchPlaces('  ')).rejects.toMatchObject({ statusCode: 400 })
    await expect(searchPlaces('杭州', { env: { WEATHER_ENABLED: 'false' } })).rejects.toMatchObject({ statusCode: 503, code: 'WEATHER_UNAVAILABLE' })
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))))
    await expect(searchPlaces('杭州')).rejects.toMatchObject({ statusCode: 503, code: 'WEATHER_UNAVAILABLE' })
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('杭州')
  })
})

describe('预报', () => {
  it('解析今天、明天与此刻，温度取整', () => {
    expect(parseForecast(FORECAST)).toEqual({
      current: { temperature: 24, condition: '晴间多云', icon: 'partly' },
      today: { date: '2026-09-27', condition: '小雨', icon: 'rain', max: 23, min: 16, precipitation: 80 },
      tomorrow: { date: '2026-09-28', condition: '阴', icon: 'cloudy', max: 15, min: 10, precipitation: 10 },
    })
  })

  it('缺明天就当取不到，不拼半张卡片', () => {
    const partial = { ...FORECAST, daily: { ...FORECAST.daily, time: ['2026-09-27'], weather_code: [61] } }
    expect(() => parseForecast(partial)).toThrow()
  })

  it('半小时内同一片地方只问一次数据源', async () => {
    const fetch = vi.fn(() => ok(FORECAST))
    vi.stubGlobal('fetch', fetch)
    const now = Date.parse('2026-09-27T12:00:00Z')
    await getForecast(HANGZHOU, { now })
    await getForecast({ ...HANGZHOU, latitude: 30.2911 }, { now: now + 10 * 60 * 1000 })
    expect(fetch).toHaveBeenCalledTimes(1)
    await getForecast(HANGZHOU, { now: now + 31 * 60 * 1000 })
    expect(fetch).toHaveBeenCalledTimes(2)
    const url = new URL(fetch.mock.calls[0][0])
    expect(url.searchParams.get('timezone')).toBe('Asia/Shanghai')
    expect(url.searchParams.get('forecast_days')).toBe('2')
  })

  it('数据源非 200 时 503', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 502 })))
    await expect(getForecast(HANGZHOU)).rejects.toMatchObject({ statusCode: 503 })
  })
})

describe('用户的城市与天气', () => {
  it('保存时只存校验过的字段，回给界面的不带坐标', async () => {
    db.userUpdate.mockResolvedValue({})
    const result = await setPlace('u1', { ...HANGZHOU, extra: 'x' })
    expect(db.userUpdate).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { weatherPlace: HANGZHOU } })
    expect(result).toEqual({ place: { name: '杭州', admin1: '浙江', country: '中国' } })
  })

  it('清除城市', async () => {
    db.userUpdate.mockResolvedValue({})
    await expect(clearPlace('u1')).resolves.toEqual({ place: null })
    expect(db.userUpdate.mock.calls[0][0].where).toEqual({ id: 'u1' })
  })

  it('没填城市时不查天气', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    db.userFindUnique.mockResolvedValue({ weatherPlace: null })
    await expect(getUserWeather('u1')).resolves.toEqual({ place: null })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('填了城市：回城市、今天、明天与署名', async () => {
    vi.stubGlobal('fetch', vi.fn(() => ok(FORECAST)))
    db.userFindUnique.mockResolvedValue({ weatherPlace: HANGZHOU })
    const weather = await getUserWeather('u1')
    expect(weather.place).toEqual({ name: '杭州', admin1: '浙江', country: '中国' })
    expect(weather.tomorrow.condition).toBe('阴')
    expect(weather.source).toBe('Open-Meteo')
    expect(weather).not.toHaveProperty('latitude')
  })

  it('填了城市但功能关闭：如实 503', async () => {
    db.userFindUnique.mockResolvedValue({ weatherPlace: HANGZHOU })
    await expect(getUserWeather('u1', { env: { WEATHER_ENABLED: 'false' } })).rejects.toMatchObject({ statusCode: 503 })
  })
})

describe('聊天上下文', () => {
  it('没填、关闭或存的值读不通时回 null，不发请求', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(weatherForContext(null)).resolves.toBeNull()
    await expect(weatherForContext({ name: '杭州' })).resolves.toBeNull()
    await expect(weatherForContext(HANGZHOU, { env: { WEATHER_ENABLED: 'false' } })).resolves.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('填了城市：带上城市与两天预报', async () => {
    vi.stubGlobal('fetch', vi.fn(() => ok(FORECAST)))
    const weather = await weatherForContext(HANGZHOU)
    expect(weather.place.name).toBe('杭州')
    expect(weather.today.condition).toBe('小雨')
  })
})
