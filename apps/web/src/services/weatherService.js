import api from './api'

// 每日天气：城市是你自己在设置里填的，不定位；取不到时服务器如实 503，界面就不显示。
// 不放进 toolsService——那里只承载经期记录，旧的假天气已删除。
export const weatherService = {
  getWeather: async () => (await api.get('/weather')).data,
  searchPlaces: async (q) => {
    const places = (await api.get('/weather/places', { params: { q } })).data?.places
    return Array.isArray(places) ? places : []
  },
  setPlace: async (place) => (await api.put('/weather/place', place)).data,
  clearPlace: async () => (await api.delete('/weather/place')).data,
}
