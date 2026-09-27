/**
 * 每日天气：用户在设置里自己填的城市 + Open-Meteo（免费、无密钥；数据 CC BY 4.0，界面需署名）。
 *
 * 不定位：只存用户从候选里选中的城市名与坐标，可随时清除。
 * 照仓库诚实不可用范式：未开启或拉取失败一律如实 503 WEATHER_UNAVAILABLE，前端不展示，绝不给假天气。
 * 日志只记错误码，不记城市、坐标与查询词。
 */
import { Prisma } from '@prisma/client'
import prisma from '../prisma/client.js'
import { HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'

const GEOCODING_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast'
const FETCH_TIMEOUT_MS = 5000
const CACHE_TTL_MS = 30 * 60 * 1000
const CACHE_MAX = 500
const MAX_QUERY_CHARS = 40
const MAX_NAME_CHARS = 40
const MAX_PLACES = 5
const TIMEZONE_RE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/

export const WEATHER_SOURCE = 'Open-Meteo'

// WMO 天气代码 → 中文天气与图标键（图标由前端手绘线稿承担）
const CONDITIONS = [
  [[0], '晴', 'clear'],
  [[1], '晴间多云', 'partly'],
  [[2], '多云', 'partly'],
  [[3], '阴', 'cloudy'],
  [[45, 48], '雾', 'fog'],
  [[51, 53, 55, 56, 57], '毛毛雨', 'rain'],
  [[61, 80], '小雨', 'rain'],
  [[63, 81], '中雨', 'rain'],
  [[65, 82], '大雨', 'rain'],
  [[66, 67], '冻雨', 'rain'],
  [[71, 85], '小雪', 'snow'],
  [[73], '中雪', 'snow'],
  [[75, 86], '大雪', 'snow'],
  [[77], '雪粒', 'snow'],
  // 96/99 本是「伴冰雹」，但 Open-Meteo 说明冰雹只在中欧可靠；宁可少说，统一叫雷阵雨
  [[95, 96, 99], '雷阵雨', 'thunder'],
]

/** 不认识的代码返回 null：宁可不说，也不猜一个天气。 */
export function describeWeatherCode(code) {
  const entry = CONDITIONS.find(([codes]) => codes.includes(Number(code)))
  return entry ? { condition: entry[1], icon: entry[2] } : null
}

export function isWeatherEnabled(env = process.env) {
  return env.WEATHER_ENABLED !== 'false'
}

function unavailable(message = '天气暂时取不到，请稍后再看') {
  const error = new HttpError(message, 503)
  error.code = 'WEATHER_UNAVAILABLE'
  return error
}

async function fetchJson(url, timeoutMs) {
  let response
  try {
    response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    logger.warn('天气数据源请求失败', { code: error?.name === 'TimeoutError' ? 'TIMEOUT' : 'FETCH_FAILED' })
    throw unavailable()
  }
  if (!response.ok) {
    logger.warn('天气数据源返回错误', { code: `HTTP_${response.status}` })
    throw unavailable()
  }
  try {
    return await response.json()
  } catch {
    logger.warn('天气数据源返回无法解析', { code: 'BAD_JSON' })
    throw unavailable()
  }
}

function text(value, max) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function coordinate(value, limit) {
  const number = typeof value === 'number' ? value : Number.NaN
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null
}

/** 服务端校验用户选中的城市；只保留城市名、省份、国家、坐标与时区。 */
export function normalizePlace(input) {
  const name = text(input?.name, MAX_NAME_CHARS)
  const latitude = coordinate(input?.latitude, 90)
  const longitude = coordinate(input?.longitude, 180)
  if (!name || latitude === null || longitude === null) {
    throw new HttpError('请从候选里选一个城市', 400)
  }
  const timezone = text(input?.timezone, 64)
  return {
    name,
    admin1: text(input?.admin1, MAX_NAME_CHARS),
    country: text(input?.country, MAX_NAME_CHARS),
    latitude,
    longitude,
    timezone: timezone && TIMEZONE_RE.test(timezone) ? timezone : null,
  }
}

/** 库里存的值可能来自旧版本或被手改过：读不通就当没填。 */
function storedPlace(value) {
  try {
    return value ? normalizePlace(value) : null
  } catch {
    return null
  }
}

/** 给界面看的城市：不回坐标。 */
function publicPlace(place) {
  return { name: place.name, admin1: place.admin1, country: place.country }
}

/** 按城市名找候选（最多 5 个），交给用户自己选；不做任何定位。 */
export async function searchPlaces(query, { env = process.env } = {}) {
  if (!isWeatherEnabled(env)) throw unavailable('天气功能未开启')
  const keyword = String(query ?? '').trim().slice(0, MAX_QUERY_CHARS)
  if (!keyword) throw new HttpError('请输入城市名', 400)
  const params = new URLSearchParams({ name: keyword, count: String(MAX_PLACES), language: 'zh', format: 'json' })
  const data = await fetchJson(`${GEOCODING_ENDPOINT}?${params}`, FETCH_TIMEOUT_MS)
  const places = []
  for (const result of Array.isArray(data?.results) ? data.results : []) {
    try {
      places.push(normalizePlace(result))
    } catch {
      // 缺坐标或名字的候选直接丢掉
    }
    if (places.length >= MAX_PLACES) break
  }
  return { places }
}

export async function getPlace(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { weatherPlace: true } })
  return storedPlace(user?.weatherPlace)
}

export async function setPlace(userId, input) {
  const place = normalizePlace(input)
  await prisma.user.update({ where: { id: userId }, data: { weatherPlace: place } })
  return { place: publicPlace(place) }
}

export async function clearPlace(userId) {
  await prisma.user.update({ where: { id: userId }, data: { weatherPlace: Prisma.DbNull } })
  return { place: null }
}

// 同一片地方半小时内只问一次数据源；坐标取两位小数（约 1 公里）做键
const cache = new Map()

export function clearWeatherCache() {
  cache.clear()
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value) : null
}

function day(daily, index) {
  const described = describeWeatherCode(daily.weather_code?.[index])
  const max = round(daily.temperature_2m_max?.[index])
  const min = round(daily.temperature_2m_min?.[index])
  if (!described || max === null || min === null) return null
  const precipitation = daily.precipitation_probability_max?.[index]
  return {
    date: String(daily.time?.[index] ?? ''),
    ...described,
    max,
    min,
    precipitation: Number.isFinite(precipitation) ? Math.round(precipitation) : null,
  }
}

/** 只认完整的今天与明天；缺一块就当取不到，不拼半张假卡片。 */
export function parseForecast(data) {
  const daily = data?.daily
  const today = daily ? day(daily, 0) : null
  const tomorrow = daily ? day(daily, 1) : null
  if (!today || !tomorrow) throw unavailable()
  const described = describeWeatherCode(data?.current?.weather_code)
  const temperature = round(data?.current?.temperature_2m)
  return {
    current: described && temperature !== null ? { temperature, ...described } : null,
    today,
    tomorrow,
  }
}

export async function getForecast(place, { timeoutMs = FETCH_TIMEOUT_MS, now = Date.now() } = {}) {
  const key = `${place.latitude.toFixed(2)},${place.longitude.toFixed(2)}`
  const hit = cache.get(key)
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.value
  const params = new URLSearchParams({
    latitude: place.latitude.toFixed(4),
    longitude: place.longitude.toFixed(4),
    current: 'temperature_2m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: place.timezone ?? 'auto',
    forecast_days: '2',
  })
  const value = parseForecast(await fetchJson(`${FORECAST_ENDPOINT}?${params}`, timeoutMs))
  cache.delete(key)
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
  cache.set(key, { at: now, value })
  return value
}

/** 页头与卡片用：没填城市回 { place: null }；填了但取不到如实 503。 */
export async function getUserWeather(userId, { env = process.env } = {}) {
  const place = await getPlace(userId)
  if (!place) return { place: null }
  if (!isWeatherEnabled(env)) throw unavailable('天气功能未开启')
  const forecast = await getForecast(place)
  return { place: publicPlace(place), ...forecast, source: WEATHER_SOURCE }
}

/**
 * 聊天上下文用：短超时，没填、未开启都回 null；取不到时抛错，由调用方吞掉。
 * 绝不能拖慢或挡住这一轮聊天。
 */
export async function weatherForContext(storedValue, { env = process.env, timeoutMs = 1500 } = {}) {
  if (!isWeatherEnabled(env)) return null
  const place = storedPlace(storedValue)
  if (!place) return null
  return { place: publicPlace(place), ...(await getForecast(place, { timeoutMs })) }
}
