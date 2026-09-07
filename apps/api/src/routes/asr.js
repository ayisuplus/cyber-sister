import { Router } from 'express'
import { getAsrStatus, transcribeAudio } from '../services/asrService.js'
import { createAudioUpload } from '../utils/audioUpload.js'
import logger from '../utils/logger.js'

const router = Router()

// 音频只在内存中流转（memoryStorage），绝不落盘；≤4MB，仅 WAV（前端已转 16kHz 单声道）
const voiceUpload = createAudioUpload({
  field: 'file',
  typeMessage: '只支持 WAV 音频',
  limitMessage: '音频不能超过 4MB（约 2 分钟）',
  fallbackMessage: '音频上传失败，请重试',
})

function sendError(res, error, fallback) {
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : fallback,
    ...(error.code ? { code: error.code } : {}),
  })
}

router.get('/status', async (_req, res) => {
  try {
    res.json(await getAsrStatus())
  } catch (error) {
    logger.error('获取语音转文字状态失败', { error: error.message })
    sendError(res, error, '获取语音转文字状态失败')
  }
})

router.post('/transcribe', voiceUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请先提供音频' })
    }
    const result = await transcribeAudio({
      audioBuffer: req.file.buffer,
      audioName: req.file.originalname,
      audioMime: req.file.mimetype,
    })
    res.json(result)
  } catch (error) {
    logger.error('语音转文字失败', { error: error.message, userId: req.user.userId })
    sendError(res, error, '语音转文字失败')
  }
})

export default router
