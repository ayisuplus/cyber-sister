import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import * as petService from '../services/petService.js'

// 宠物：每天领饲料、喂它、摸它；好感度与成长值只涨不掉。
const router = Router()

// 摸一摸是连着的手势，前端一段只报一次；这里再兜一层，别让脚本刷
const petLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `pets:${req.user.userId}`,
  message: { error: '摸得太快啦，让它歇一会儿' },
})

const handle = (fn) => async (req, res, next) => {
  try { res.json(await fn(req)) } catch (error) { next(error) }
}

router.get('/', handle((req) => petService.getPets(req.user.userId)))
router.post('/daily', handle((req) => petService.claimDailyFood(req.user.userId)))
router.post('/', handle((req) => petService.adopt(req.user.userId, req.body ?? {})))
router.put('/active', handle((req) => petService.setActive(req.user.userId, req.body?.species)))
router.put('/:species', handle((req) => petService.rename(req.user.userId, req.params.species, req.body?.name)))
router.post('/:species/feed', petLimiter, handle((req) => petService.feed(req.user.userId, req.params.species)))
router.post('/:species/pet', petLimiter, handle((req) => petService.pet(req.user.userId, req.params.species)))

export default router
