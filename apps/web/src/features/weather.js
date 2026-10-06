// 页头那一行天气与卡片里的一句话：纯函数，时段按这台设备的本地时间。
// 傍晚以后躺下想的是明天要不要带伞，所以 18 点到清晨 5 点看明天。

export const showsTomorrow = (hour) => hour >= 18 || hour < 5

const range = (day) => `${day.min}–${day.max}°`

/** 页头的一行小字；没有可用的天气时返回 null（界面整行不渲染，绝不拼假数据）。 */
export function weatherLine(weather, hour) {
  if (!weather?.place?.name || !weather.today || !weather.tomorrow) return null
  if (showsTomorrow(hour)) {
    return { icon: weather.tomorrow.icon, text: `明天 · ${weather.tomorrow.condition} ${range(weather.tomorrow)}` }
  }
  const now = weather.current
  return now
    ? { icon: now.icon, text: `${weather.place.name} · ${now.condition} ${now.temperature}°` }
    : { icon: weather.today.icon, text: `${weather.place.name} · ${weather.today.condition} ${range(weather.today)}` }
}

const likelyWet = (day) => day.icon === 'thunder' || (Number.isFinite(day.precipitation) ? day.precipitation >= 50 : day.icon === 'rain')

/**
 * 卡片里最多一句，按规则来、不调模型；是惦记，不是催你办事（路线图 C13）。
 * 看今天还是明天跟页头一致；什么都不值得说时返回 null。
 */
export function weatherTip(weather, hour) {
  if (!weather?.today || !weather.tomorrow) return null
  const tomorrow = showsTomorrow(hour)
  const day = tomorrow ? weather.tomorrow : weather.today
  const when = tomorrow ? '明天' : '今天'
  if (day.icon === 'snow') return `${when}可能下雪，路上慢慢走`
  if (likelyWet(day)) return `${when}可能下雨，出门别淋着`
  if (tomorrow && weather.tomorrow.max - weather.today.max <= -6) return '明天降温了，多穿一件'
  if (day.max >= 33) return `${when}很热，记得多喝水`
  if (day.max <= 5) return `${when}挺冷的，多穿一点`
  return null
}
