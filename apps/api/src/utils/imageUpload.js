/**
 * 图片上传中间件工厂：memoryStorage（不落盘）、≤8MB、单文件、仅 JPEG/PNG/WebP。
 * multer 错误统一转 400 JSON（超限 / 类型不符 / 其他上传错误），文案由调用方给定。
 */
import multer from 'multer'

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export function createImageUpload({ field, typeMessage, limitMessage, fallbackMessage }) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (IMAGE_MIME_TYPES.has(file.mimetype)) return cb(null, true)
      cb(Object.assign(new Error(typeMessage), { statusCode: 400 }))
    },
  })

  return function imageUpload(req, res, next) {
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

/**
 * 收藏用：一次最多两张 JPEG（photo 原图 + thumb 缩略图），都可省略；其余是文字字段。
 * 文件签名与大小由 collectionService 再查一遍（改了扩展名的文件骗不过去）。
 */
export function createCollectionUpload({ maxBytes }) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 2, fields: 10, fieldSize: 4096 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype === 'image/jpeg') return cb(null, true)
      cb(Object.assign(new Error('照片要先在这台设备上压缩成 JPEG 再上传'), { statusCode: 400 }))
    },
  }).fields([{ name: 'photo', maxCount: 1 }, { name: 'thumb', maxCount: 1 }])

  return function collectionUpload(req, res, next) {
    upload(req, res, (error) => {
      if (!error) return next()
      if (error instanceof multer.MulterError) {
        return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? '这张照片太大了，请换一张' : '照片没传上来，请重试' })
      }
      return res.status(error.statusCode || 400).json({ error: error.message || '照片没传上来，请重试' })
    })
  }
}
