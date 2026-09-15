import multer from 'multer'
import { TextDecoder } from 'node:util'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 4, fields: 1, fieldSize: 40000, parts: 6 },
  fileFilter: (_req, file, callback) => {
    if (file.fieldname === 'image' && !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      callback(new Error('仅支持 JPEG/PNG/WebP 图片'))
    } else callback(null, true)
  },
}).fields([{ name: 'image', maxCount: 1 }, { name: 'files', maxCount: 3 }])

export function workMessageUpload(req, res, next) {
  if (!req.is('multipart/form-data')) return next()
  return upload(req, res, (error) => {
    if (error) return res.status(400).json({ error: error.message === '仅支持 JPEG/PNG/WebP 图片' ? error.message : error.code === 'LIMIT_FILE_SIZE' ? '图片不能超过 8MB，文档不能超过 5MB' : '上传失败：请检查文件格式、数量和消息长度' })
    req.file = req.files?.image?.[0]
    req.workFiles = req.files?.files || []
    // Multipart filenames from browsers are UTF-8; busboy exposes them as Latin-1 by default.
    for (const file of req.workFiles) {
      if (file.size > 5 * 1024 * 1024) return res.status(400).json({ error: '每个文档不能超过 5MB' })
      if (![...file.originalname].some((character) => character.charCodeAt(0) > 255)) {
        try { file.originalname = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(file.originalname, 'latin1')) } catch { /* Keep an already-decoded filename. */ }
      }
    }
    return next()
  })
}
