import { Router } from 'express'
import { validateEnum, validate } from '../utils/validate.js'
import * as userService from '../services/userService.js'
import logger from '../utils/logger.js'

const router = Router()

router.get('/profile', async (req, res) => {
  try {
    const user = await userService.getProfile(req.user.userId)
    res.json(user)
  } catch (error) {
    logger.error('获取用户信息失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取用户信息失败' })
  }
})

router.put('/profile', async (req, res) => {
  try {
    const user = await userService.updateProfile(req.user.userId, req.body)
    res.json(user)
  } catch (error) {
    logger.error('更新用户信息失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '更新用户信息失败' })
  }
})

router.put('/persona', validate([
  { field: 'persona', validate: (v) => validateEnum(v, '人格', ['toxic', 'gentle', 'wild']) },
]), async (req, res) => {
  try {
    const user = await userService.switchPersona(req.user.userId, req.body.persona)
    res.json(user)
  } catch (error) {
    logger.error('切换人格失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '切换人格失败' })
  }
})

router.get('/membership', async (req, res) => {
  try {
    const data = await userService.getMembership(req.user.userId)
    res.json(data)
  } catch (error) {
    logger.error('获取会员状态失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '获取会员状态失败' })
  }
})

router.post('/membership/subscribe', async (req, res) => {
  try {
    const result = await userService.subscribeMembership(req.user.userId)
    res.json(result)
  } catch (error) {
    logger.error('开通会员失败', { error: error.message, userId: req.user.userId })
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '开通会员失败' })
  }
})

export default router
