import { Router } from 'express'
import * as llmFeatureService from '../services/llmFeatureService.js'

const router = Router()

function sendError(res, error, fallback) {
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : fallback,
    ...(error.code ? { code: error.code } : {}),
  })
}

router.get('/status', async (req, res) => {
  try {
    res.json(await llmFeatureService.getLlmStatus(req.user.userId))
  } catch (error) {
    sendError(res, error, '获取本地模型状态失败')
  }
})


export default router
