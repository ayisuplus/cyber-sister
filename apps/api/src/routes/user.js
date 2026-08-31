import { Router } from 'express'
import { validateEnum, validate } from '../utils/validate.js'
import * as userService from '../services/userService.js'
import logger from '../utils/logger.js'

const router = Router()

function sendError(res, error, fallback) {
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : fallback,
    ...(error.code ? { code: error.code } : {}),
  })
}

router.get('/profile', async (req, res) => {
  try {
    res.json(await userService.getProfile(req.user.userId))
  } catch (error) {
    logger.error('获取用户信息失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '获取用户信息失败')
  }
})

router.put('/profile', async (req, res) => {
  try {
    res.json(await userService.updateProfile(req.user.userId, req.body))
  } catch (error) {
    logger.error('更新用户信息失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '更新用户信息失败')
  }
})

router.put('/persona', validate([
  { field: 'persona', validate: (value) => validateEnum(value, '人格', userService.PERSONAS) },
]), async (req, res) => {
  try {
    res.json(await userService.switchPersona(req.user.userId, req.body.persona))
  } catch (error) {
    logger.error('切换人格失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '切换人格失败')
  }
})

router.get('/external-llm-consent', async (req, res) => {
  try {
    res.json(await userService.getExternalLlmConsent(req.user.userId))
  } catch (error) {
    logger.error('获取外部模型同意状态失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '获取外部模型同意状态失败')
  }
})

router.put('/external-llm-consent', async (req, res) => {
  try {
    res.json(await userService.updateExternalLlmConsent(req.user.userId, req.body.accepted))
  } catch (error) {
    logger.error('更新外部模型同意状态失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '更新外部模型同意状态失败')
  }
})

router.get('/membership', async (req, res) => {
  try {
    res.json(await userService.getMembership(req.user.userId))
  } catch (error) {
    logger.error('获取会员状态失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '获取会员状态失败')
  }
})

router.post('/membership/subscribe', async (req, res) => {
  try {
    res.json(await userService.subscribeMembership(req.user.userId))
  } catch (error) {
    logger.error('开通会员失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '开通会员失败')
  }
})

export default router
