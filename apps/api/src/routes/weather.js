import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import * as weatherService from '../services/weatherService.js'

// 每日天气：城市是用户自己在设置里填的，不定位；取不到如实 503，前端不展示。
const router = Router()

// 找城市是打字时才会连续触发的；按用户限额，别让一个人把数据源的免费额度用光
const placesLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `weather:${req.user.userId}`,
  message: { error: '找城市有点太频繁了，稍等一下再试' },
})

router.get('/', async (req, res, next) => {
  try { res.json(await weatherService.getUserWeather(req.user.userId)) } catch (error) { next(error) }
})

router.get('/places', placesLimiter, async (req, res, next) => {
  try { res.json(await weatherService.searchPlaces(req.query.q)) } catch (error) { next(error) }
})

router.put('/place', async (req, res, next) => {
  try { res.json(await weatherService.setPlace(req.user.userId, req.body)) } catch (error) { next(error) }
})

router.delete('/place', async (req, res, next) => {
  try { res.json(await weatherService.clearPlace(req.user.userId)) } catch (error) { next(error) }
})

export default router
