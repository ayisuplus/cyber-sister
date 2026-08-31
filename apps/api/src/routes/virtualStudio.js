import { Router } from 'express'
import { validateRequired, validateLength, validateEnum, validate } from '../utils/validate.js'
import { getImageGenStatus, requestGeneration } from '../services/imageGenService.js'
import logger from '../utils/logger.js'

const router = Router()

function sendError(res, error, fallback) {
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : fallback,
    ...(error.code ? { code: error.code } : {}),
  })
}

router.get('/image-gen/status', (_req, res) => {
  try {
    res.json(getImageGenStatus())
  } catch (error) {
    logger.error('获取生图能力状态失败', { error: error.message })
    sendError(res, error, '获取生图能力状态失败')
  }
})

router.post('/image-gen/generations', validate([
  {
    field: 'scene',
    validate: (value) => validateRequired(value, '场景')
      || validateEnum(value, '场景', ['makeup', 'fitting']),
  },
  {
    field: 'itemId',
    validate: (value) => validateRequired(value, 'itemId')
      || validateLength(value, 'itemId', 1, 64),
  },
  { field: 'note', validate: (value) => validateLength(value, 'note', 0, 200) },
]), async (req, res) => {
  try {
    const { scene, itemId, note } = req.body
    const result = await requestGeneration({ scene, itemId, note })
    res.status(201).json(result)
  } catch (error) {
    logger.error('生图请求失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '生图请求失败')
  }
})

export default router
