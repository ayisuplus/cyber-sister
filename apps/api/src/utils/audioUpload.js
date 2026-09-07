/**
 * 音频上传中间件工厂：memoryStorage（不落盘）、≤4MB、单文件、仅 WAV。
 * 16kHz 16bit 单声道 WAV ≈32KB/s，4MB 覆盖约 2 分钟语音。
 * multer 错误统一转 400 JSON（超限 / 类型不符 / 其他上传错误），文案由调用方给定。
 */
import multer from 'multer'

const AUDIO_MIME_TYPES = new Set(['audio/wav', 'audio/x-wav', 'audio/wave'])
const MAX_AUDIO_BYTES = 4 * 1024 * 1024

export function createAudioUpload({ field, typeMessage, limitMessage, fallbackMessage }) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (AUDIO_MIME_TYPES.has(file.mimetype)) return cb(null, true)
      cb(Object.assign(new Error(typeMessage), { statusCode: 400 }))
    },
  })

  return function audioUpload(req, res, next) {
    upload.single(field)(req, res, (error) => {
      if (!error) return next()
      if (error instanceof multer.MulterError) {
        const message = error.code === 'LIMIT_FILE_SIZE' ? limitMessage : fallbackMessage
        return res.status(400).json({ error: message })
      }
      return res.status(error.statusCode || 400).json({ error: error.message || fallbackMessage })
    })
  }
}
