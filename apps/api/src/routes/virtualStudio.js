import { Router } from 'express'
import { validateRequired, validateLength, validateEnum, validate } from '../utils/validate.js'
import { getImageGenStatus, requestGeneration } from '../services/imageGenService.js'
import { createImageUpload } from '../utils/imageUpload.js'
import logger from '../utils/logger.js'

const router = Router()

// 照片只在内存中流转（memoryStorage），绝不落盘；≤8MB，仅 JPEG/PNG/WebP
const photoUpload = createImageUpload({
  field: 'photo',
  typeMessage: '只支持 JPEG、PNG 或 WebP 照片',
  limitMessage: '照片不能超过 8MB',
  fallbackMessage: '照片上传失败，请重试',
})

function sendError(res, error, fallback) {
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : fallback,
    ...(error.code ? { code: error.code } : {}),
  })
}

router.get('/image-gen/status', async (_req, res) => {
  try {
    res.json(await getImageGenStatus())
  } catch (error) {
    logger.error('获取生图能力状态失败', { error: error.message })
    sendError(res, error, '获取生图能力状态失败')
  }
})

router.post('/image-gen/generations', photoUpload, validate([
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
    if (!req.file) {
      return res.status(400).json({ error: '请先上传照片' })
    }
    const { scene, itemId, note } = req.body
    const result = await requestGeneration({
      scene,
      itemId,
      note,
      photoBuffer: req.file.buffer,
      photoName: req.file.originalname,
      photoMime: req.file.mimetype,
    }, req.requestId)
    res.status(201).json(result)
  } catch (error) {
    logger.error('生图请求失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '生图请求失败')
  }
})

export default router
