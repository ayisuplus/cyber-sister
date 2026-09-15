import { Router } from 'express'
import multer from 'multer'
import { IMAGE_MIME_TYPES, MAX_IMAGE_BYTES, previewMakeup, previewWardrobe } from '../services/workMediaService.js'

const router = Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 1, fieldSize: 1024 },
  fileFilter: (_req, file, next) => next(IMAGE_MIME_TYPES.has(file.mimetype) ? null : new Error('仅支持 JPEG/PNG/WebP 图片'), true),
}).single('image')

function imageUpload(req, res, next) {
  res.set('Cache-Control', 'no-store')
  upload(req, res, error => {
    if (!error) return next()
    const tooLarge = error.code === 'LIMIT_FILE_SIZE'
    res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? '图片不能超过 8MB' : '图片上传失败，请检查图片类型和表单字段' })
  })
}

router.post('/makeup/preview', imageUpload, (req, res) => {
  try {
    if (Object.keys(req.body || {}).some(key => key !== 'params')) throw new Error('只接受图片和美颜参数')
    let params
    try { params = JSON.parse(req.body?.params) } catch { throw new Error('美颜参数必须是有效 JSON') }
    res.json(previewMakeup({ buffer: req.file?.buffer, mime: req.file?.mimetype, params }))
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message })
  }
})

router.post('/wardrobe/preview', imageUpload, (req, res) => {
  try {
    if (Object.keys(req.body || {}).some(key => key !== 'name')) throw new Error('只接受图片和单品名字')
    res.json(previewWardrobe({ buffer: req.file?.buffer, mime: req.file?.mimetype, name: req.body?.name }))
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message })
  }
})

export default router
